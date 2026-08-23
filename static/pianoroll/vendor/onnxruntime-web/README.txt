AudioAnalysis V0 runtime asset

Runtime: onnxruntime-web 1.18.0, WASM-only build.
Source: https://www.npmjs.com/package/onnxruntime-web/v/1.18.0
License: MIT, see the ONNX Runtime repository for the full license text.

The browser worker pins numThreads=1 so the studio does not require
cross-origin isolation or a server-side TensorFlow installation.
