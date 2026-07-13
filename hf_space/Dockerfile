FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/hf_cache \
    HF_HUB_OFFLINE=0 \
    TRANSFORMERS_OFFLINE=1 \
    EMBED_ONLY=1 \
    SECOND_OPINION=0 \
    FASTTEXT_COMPRESSED=/app/data/cc.he.300.fp16.bin \
    FEEDBACK_DIR=/tmp/cn_feedback \
    FEEDBACK_DATASET=shmulc/codenames-feedback \
    HOST=0.0.0.0 \
    PORT=7860 \
    WARMUP=1

WORKDIR /app

RUN pip install --upgrade pip \
 && pip install torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install -r requirements.txt

# Pre-download DictaBERT-lex (lemmatizer → clue legality) at build time so the running
# container is fully offline and the first clue isn't blocked on a download.
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python -c "from transformers import AutoModel, AutoTokenizer; AutoTokenizer.from_pretrained('dicta-il/dictabert-lex'); AutoModel.from_pretrained('dicta-il/dictabert-lex', trust_remote_code=True)"

COPY . .

EXPOSE 7860
CMD ["python", "app.py"]
