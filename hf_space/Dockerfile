FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/src \
    HF_HOME=/app/hf_cache \
    TRANSFORMERS_OFFLINE=1 \
    EMBED_ONLY=1 \
    SECOND_OPINION=0 \
    FASTTEXT_COMPRESSED=/app/data/cc.he.300.fp16.bin \
    FEEDBACK_DIR=/tmp/cn_feedback \
    FEEDBACK_DATASET=shmulc/codenames-feedback \
    HOST=0.0.0.0 \
    PORT=7860 \
    WARMUP=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1

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
# gunicorn, one gthread worker: all threads share one copy of the models (~1 GB), and 8 threads
# bound concurrent engine work on the 2-vCPU Space; further connections queue (backlog) instead
# of spawning unbounded threads. BLAS/torch run single-threaded per request (env above) so the
# threads don't oversubscribe the cores. No --preload: the feedback CommitScheduler thread and
# torch must start in the worker, not in a parent that forks. Startup + warmup run inside
# create_app(); --timeout covers that cold boot (gthread workers heartbeat from the main loop,
# so it is a liveness bound, not a per-request one).
CMD ["gunicorn", "--worker-class", "gthread", "--workers", "1", "--threads", "8", \
     "--timeout", "600", "--graceful-timeout", "30", "--keep-alive", "5", "--backlog", "256", \
     "--bind", "0.0.0.0:7860", "--access-logfile", "-", "codenames.app:create_app()"]
