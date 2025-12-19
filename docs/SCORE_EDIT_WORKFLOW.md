# Hum2Song 可编辑乐谱工作流（本地）

## 1) 生成并下载 MIDI
```powershell
python -m hum2song.cli synth .\outputs\scores\edited.mid --format mp3 --out-dir .\outputs\edited
## 4) 再合成音频（从编辑后的 MIDI）
```powershell
python -m hum2song.cli synth .\outputs\scores\edited.mid --format mp3 --out-dir .\outputs\edited
