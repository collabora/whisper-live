# original: https://huggingface.co/blog/fine-tune-whisper

"""Finetune Whisper on custom dataset"""

import torch
import evaluate

from dataclasses import dataclass
from typing import Any, Dict, List, Union
from datasets import load_dataset, DatasetDict, Audio
from transformers import WhisperFeatureExtractor, WhisperTokenizer, WhisperProcessor
from transformers import WhisperForConditionalGeneration
from transformers import Seq2SeqTrainingArguments, Seq2SeqTrainer


def load_custom_dataset_hf(
    name="mozilla-foundation/common_voice_11_0",
    subset="hi",
    train_split="train+validation",
    test_split="test",
    sr=16000,
    use_auth_token=True):
    """
    """
    ds = DatasetDict()

    ds["train"] = load_dataset(name, subset, split=train_split, use_auth_token=use_auth_token)
    ds["test"] = load_dataset(name, subset, split=test_split, use_auth_token=use_auth_token)

    dataset_sampling_rate = next(iter(ds.values())).features["audio"].sampling_rate
    if dataset_sampling_rate != sr:
        ds = ds.cast_column(
            "audio", Audio(sampling_rate=sr)
        )
    return ds

@dataclass
class DataCollatorSpeechSeq2SeqWithPadding:
    processor: Any

    def __call__(self, features: List[Dict[str, Union[List[int], torch.Tensor]]]) -> Dict[str, torch.Tensor]:
        # split inputs and labels since they have to be of different lengths and need different padding methods
        # first treat the audio inputs by simply returning torch tensors
        input_features = [{"input_features": feature["input_features"]} for feature in features]
        batch = self.processor.feature_extractor.pad(input_features, return_tensors="pt")

        # get the tokenized label sequences
        label_features = [{"input_ids": feature["labels"]} for feature in features]
        # pad the labels to max length
        labels_batch = self.processor.tokenizer.pad(label_features, return_tensors="pt")

        # replace padding with -100 to ignore loss correctly
        labels = labels_batch["input_ids"].masked_fill(labels_batch.attention_mask.ne(1), -100)

        # if bos token is appended in previous tokenization step,
        # cut bos token here as it's append later anyways
        if (labels[:, 0] == self.processor.tokenizer.bos_token_id).all().cpu().item():
            labels = labels[:, 1:]

        batch["labels"] = labels

        return batch
 
    


def train(dataset, model_size="tiny", language="Hindi"):
    feature_extractor = WhisperFeatureExtractor.from_pretrained(
        f"openai/whisper-{model_size}")

    tokenizer = WhisperTokenizer.from_pretrained(
        f"openai/whisper-{model_size}", language=language, task="transcribe")
    processor = WhisperProcessor.from_pretrained(
        f"openai/whisper-{model_size}", language=language, task="transcribe")

    def prepare_dataset(batch):
        # load and resample audio data from 48 to 16kHz
        audio = batch["audio"]

        # compute log-Mel input features from input audio array 
        batch["input_features"] = feature_extractor(audio["array"], sampling_rate=audio["sampling_rate"]).input_features[0]

        # encode target text to label ids 
        batch["labels"] = tokenizer(batch["sentence"]).input_ids
        return batch
    
    dataset = dataset.map(
        prepare_dataset, remove_columns=dataset.column_names["train"], num_proc=4)
    
    data_collator = DataCollatorSpeechSeq2SeqWithPadding(processor=processor)
    metric = evaluate.load("wer")
    model = WhisperForConditionalGeneration.from_pretrained(f"openai/whisper-{model_size}")
    model.config.forced_decoder_ids = None
    model.config.suppress_tokens = []

    def compute_metrics(pred):
        pred_ids = pred.predictions
        label_ids = pred.label_ids

        # replace -100 with the pad_token_id
        label_ids[label_ids == -100] = tokenizer.pad_token_id

        # we do not want to group tokens when computing the metrics
        pred_str = tokenizer.batch_decode(pred_ids, skip_special_tokens=True)
        label_str = tokenizer.batch_decode(label_ids, skip_special_tokens=True)

        wer = 100 * metric.compute(predictions=pred_str, references=label_str)

        return {"wer": wer}
    

    training_args = Seq2SeqTrainingArguments(
        output_dir=f"./whisper-{model_size}-{language}",  # change to a repo name of your choice
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,  # increase by 2x for every 2x decrease in batch size
        learning_rate=1e-5,
        warmup_steps=500,
        max_steps=4000,
        gradient_checkpointing=True,
        fp16=True,
        evaluation_strategy="steps",
        per_device_eval_batch_size=8,
        predict_with_generate=True,
        generation_max_length=225,
        save_steps=1000,
        eval_steps=1000,
        logging_steps=25,
        report_to=["tensorboard"],
        load_best_model_at_end=True,
        metric_for_best_model="wer",
        greater_is_better=False,
        push_to_hub=True,
    )

    trainer = Seq2SeqTrainer(
        args=training_args,
        model=model,
        train_dataset=dataset["train"],
        eval_dataset=dataset["test"],
        data_collator=data_collator,
        compute_metrics=compute_metrics,
        tokenizer=processor.feature_extractor,
    )

    trainer.train()


if __name__=="__main__":
    ds = load_custom_dataset_hf(train_split="validation", test_split="validation")
    train(ds)