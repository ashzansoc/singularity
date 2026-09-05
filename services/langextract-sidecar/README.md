# LangExtract Sidecar

Stdio JSON-lines service wrapping Google [`langextract==1.6.0`](https://pypi.org/project/langextract/).

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Protocol

Request (stdin, one JSON object per line):

```json
{"id":"req_1","op":"extract","text":"...","source_metadata":{"type":"conversation"},"existing_state_summary":"...","complexity":"simple","config":{"model":"gemini-2.0-flash","api_key":"..."}}
```

Response (stdout):

```json
{"id":"req_1","ok":true,"delta":{...},"raw_item_count":3,"provider":"langextract","model":"gemini-2.0-flash"}
```

## Manual ping

```bash
echo '{"id":"1","op":"ping"}' | python3 main.py
```
