# Go Backend Server (hosted on AWS Lambda)

### Routes:

- `GET /v1/health` - Health check endpoint that returns a status 200 + "OK" if the server is running.
- `GET /v1/music/score` - Fetch a single score by `id` for a specific `userId`.
- `DELETE /v1/music/score` - Delete a single score by `id` for a specific `userId`.
- `GET /v1/music/scores` - Fetch all scores for a specific `userId`.
- `GET /v1/storage/midi` - Download the MIDI file for a score (`id` + `userId`).
- `POST /v1/storage/midi` - Upload a MIDI file and create a score record (`userId` + `filePath`).

## Building for AWS Lambda

Run the following cmds:

```bash
GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bootstrap . # arm64 is cheaper than amd64 on AWS Lambda
zip -r build/lambda.zip bootstrap certs/ # add certs/global-bundle.pem to access AWS RDS DB
rm bootstrap
```

This will create a zip file within the build/ directory that can be uploaded to AWS Lambda. The `-tags lambda.norpc` flag is used to exclude the RPC server code, which is not needed when running in AWS Lambda.

> [!CAUTION]
> AWS Lambda Function URLs have a maximum request payload size of 6 MB. This is not ideal for large uploads to S3, but works for this app because MIDI files are small (<100 KB).

## Building for web server

Run the following cmd:

```bash
go build -o build/server .
```

Alternatively, to run the server locally without building, run:

```bash
go run .
```
