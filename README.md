# ASJ ATS Beta

Public beta recruitment workspace with a Node backend, static frontend, local JSON database, resume intake, duplicate handling, job extraction, candidate matching, job-specific pipeline, outreach logging, and ATS Intelligence.

## Run

```bash
npm run dev
```

Open `http://127.0.0.1:4200`.

## Resume Uploads

Go to `Website Resume Inbox` and use `Upload Resume`.

- Allowed files: PDF, DOC, DOCX
- Maximum size: 10MB
- Uploaded files are stored in `data/uploads`
- Uploaded resumes become pending inbox records. Click `Parse & Import` to create candidate profiles and application matches.

For this dependency-free local prototype, the app stores the original PDF/DOC/DOCX and uses the optional pasted text field or basic readable text extraction for parsing. In production, connect a real parser such as `pdf-parse` and `mammoth`, or a document-processing service.

## Environment

The backend reads `../.env` from the parent `ATS` folder:

```env
COHERE_API_KEY=your_key
COHERE_MODEL=command-a-03-2025
```

## Notes

The `Website Resume Inbox` represents resumes submitted through ASJ's website and stored in a database. In production, replace the local JSON inbox with PostgreSQL plus object storage resume URLs.
