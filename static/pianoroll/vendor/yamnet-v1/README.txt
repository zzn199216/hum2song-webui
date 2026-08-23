AudioAnalysis V0 model asset

Model: Qualcomm YAMNet ONNX float export
Source: https://huggingface.co/qualcomm/YamNet
Original model/source: https://github.com/tensorflow/models/tree/master/research/audioset/yamnet
License: see the source model repository and its Apache-2.0 license.

This repository stores the external-data tensors in a single ONNX file so
ONNX Runtime Web can load it without a server-side filesystem or TensorFlow.
The model returns 521 independent AudioSet logits; the browser worker applies
sigmoid and aggregates the instrument-related labels into multi-label groups.

SHA-256 yamnet.onnx:
8DCF0446AFE6A16BF9A6FE96ACAA9821F315472FF7852E2DA8829963234F6389
