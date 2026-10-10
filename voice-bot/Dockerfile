FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot.py .

RUN useradd --create-home bot
USER bot

EXPOSE 7860
CMD ["python", "bot.py", "--host", "0.0.0.0", "--port", "7860", "-t", "webrtc"]
