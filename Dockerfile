# 使用官方轻量级 Python 镜像
FROM python:3.10-slim

# 设置工作目录
WORKDIR /app

# 1. 安装系统级依赖 (这是最关键的一步)
# - ffmpeg: pydub 需要它来转换音频格式
# - fluidsynth: midi2audio 需要它来合成声音
# - libsndfile1: librosa 需要它
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fluidsynth \
    libsndfile1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 2. 复制依赖清单并安装
COPY requirements.txt .
# 使用清华源加速下载 (可选，如果服务器在国内)
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 3. 复制项目代码
COPY . .

# 4. 创建必要的目录 (以防万一)
RUN mkdir -p uploads outputs assets

# 5. 设置环境变量 (生产环境建议在运行时注入)
ENV APP_ENV=production

# 6. 暴露端口
EXPOSE 8000

# 7. 启动命令
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]