FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    MEDIA_SERVICE_HOST=0.0.0.0 \
    MEDIA_SERVICE_PORT=8000

# FFmpeg（含 ffprobe）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN mkdir -p /data

EXPOSE 8000
CMD ["python", "-m", "app.main"]
