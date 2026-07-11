# ✿ Sakura Sonata

Sakura Sonata is a monorepo for a piano tutorial visualization app. The system is split into a Next.js frontend, a Go API service, and a Go worker that converts uploaded MIDI files into MusicXML. The root app handles authentication, dashboard UX, playback, practice mode, and the visualization layer.

## Architecture

The repo is organized around three runtime processes:

1. The web app in `web/` renders the public site, dashboard, tutorial player, and client-side practice flows. Hosted on AWS ECS Fargate behind an Application Load Balancer (ALB).
2. The internal API server in `server/` owns score metadata, MIDI file retrieval, uploads, deletes, and S3/SQS-backed orchestration. Hosted on AWS Lambda with a public function URL; secured through a shared internal API secret env variable between the frontend and backend.
3. The MusicXML worker in `workers/musicxml-converter/` consumes queue messages, downloads source MIDI files from S3, converts them with MuseScore, and uploads the result back to storage. Hosted on AWS ECS Fargate.

The web app does not call the Go service directly from the browser. Instead, route handlers in `web/app/api/` forward authenticated requests to the internal API using `fetchInternalApi`, which attaches the shared internal secret and targets the AWS Lambda endpoint.

## Request Flow

The main flow is:

1. A user signs in through the Next.js app.
2. The dashboard requests score lists through `web/app/api/music/scores/route.ts`.
3. The tutorial page requests a specific score and its MIDI file through `web/app/api/music/score/route.ts` and `web/app/api/storage/midi/route.ts`.
4. The Go server validates the internal secret, queries Postgres through `pgx`, and streams objects from S3.
5. Uploads can enqueue conversion work for the MusicXML worker through SQS.

## Core Frontend Features

The primary user-facing features live in `web/app/tutorial/[id]/page.tsx` and the hook layer under `web/lib/hooks/`:

- `useMidiPlayer` loads the score metadata, fetches the MIDI file, parses timing and note data, and schedules playback with Tone.js.
- `usePracticeMode` builds practice steps from note timing, tracks MIDI input devices, and manages the discrete, continuous, and flowing modes.
- `useVideoExport` renders the visualizer and audio into a downloadable WebM file.
- `AudioPlayerTab`, `FallingNotesTab`, and `PracticeTab` split the tutorial UI into the playback, visualization, and training surfaces.
- `PlaybackSpeedControl` and the piano sound selector let the user change tempo and sampler choice without reloading the page.

The dashboard in `web/app/dashboard/page.tsx` shows the user’s saved scores and routes into the tutorial flow. The landing page in `web/app/page.tsx` is the public entry point.

## Backend Responsibilities

The Go API in `server/` exposes a small internal surface:

- `GET /v1/health` for health checks.
- `GET /v1/music/score` for a single score record.
- `DELETE /v1/music/score` for score and file deletion.
- `GET /v1/music/scores` for the user’s score list.
- `GET /v1/storage/midi` and `POST /v1/storage/midi` for MIDI download and upload.

`server/api.go` handles the request logic, `server/db/db.go` opens the Postgres connection, and `server/aws/` provides S3 and SQS client setup. The service runs either as a normal HTTP server on port 8080 or as an AWS Lambda handler.

## Worker Responsibilities

The converter worker in `workers/musicxml-converter/` runs as a long-lived process:

- `main.go` starts the queue consumer and a separate health endpoint on port 8081.
- `queue/` wraps SQS receive and delete operations.
- `storage/` wraps S3 fetch and upload operations.
- `converter.go` shells out to MuseScore CLI (`mscore`) to generate MusicXML.

## General Directory Map

```text
├── server/                         # Go internal API service
│   ├── main.go                     # HTTP/Lambda entry point
│   ├── api.go                      # score and MIDI routes
│   ├── logging.go                  # request logging and error helpers
│   ├── utils.go                    # internal secret validation
│   ├── aws/                        # AWS client helpers
│   ├── db/                         # Postgres connection helper
│   ├── certs/                      # CA bundle for DB TLS verification
│   └── build/                      # deployment lambda.zip
├── web/                            # Next.js frontend
│   ├── app/                        # App Router pages and route handlers
│   │   ├── page.tsx                # landing page
│   │   ├── dashboard/              # score library dashboard
│   │   ├── tutorial/[id]/          # tutorial and visualizer experience
│   │   ├── auth/                   # login, signup, callback, recovery
│   │   └── api/                    # Next.js API routes that proxy to Go
│   ├── components/                 # UI pieces for playback, auth, and layout
│   ├── lib/                        # client helpers, hooks, auth, piano engine
│   ├── proxy.ts                    # middleware/proxy integration
└── workers/                        # background worker processes
    ├── musicxml-converter/         # event-driven MIDI to MusicXML converter
        ├── main.go                 # worker entry point
        ├── helper.go               # SQS message processing and orchestration
        ├── converter.go            # MuseScore CLI wrapper
        ├── queue/                  # SQS interface and implementation
        ├── storage/                # S3 interface and implementation
        ├── db/                     # worker database connection helper
        └── health.go               # health endpoint
```

## Notable Environment Variables

The code relies on a small set of runtime variables:

- `AWS_REGION` for AWS client configuration.
- `AWS_LAMBDA_ENDPOINT` and `INTERNAL_API_SECRET` for the Next.js-to-Go proxy layer.
- `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`, and `DB_PORT` for Postgres.
- `SQS_QUEUE_URL`, `S3_MIDI_BUCKET`, and related AWS storage settings for upload and conversion.
- `NEXT_PUBLIC_IS_AI_FEEDBACK_ENABLED` to enable the AI feedback route in the web app.

## Local Development

The repo contains separate run targets for each service. The frontend scripts are defined in `web/package.json`, and the worker can be started with `go run .` from `workers/musicxml-converter/`. The Go API starts on port 8080 and the worker health endpoint listens on port 8081.
