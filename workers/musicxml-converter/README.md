# MusicXML Converter Worker

This service converts MIDI files to MusicXML files by running the MuseScore CLI `mscore` tool. An example is given below:

```bash
mscore input.mid -o output.musicxml
```

It takes in messages received from an SQS queue, downloads the MIDI file from S3, runs the conversion, and uploads the resulting MusicXML file back to S3.

## Development

To run the worker locally, make sure you have your AWS credentials set up and run the following command in the terminal:

```bash
go run .
```

You can double check that the worker is running by calling the health check endpoint, which should return a 200 OK response:

```bash
curl http://localhost:8081/health
```

## Production + Deployment

To deploy on AWS ECS Fargate as a service, you first should build the Docker image and push it to AWS ECR by running the following commands in the terminal:

```bash
docker build -t <ecr-repo-name> .
docker tag <ecr-repo-name>:latest <aws-ecr-repo-uri>:latest
docker push <aws-ecr-repo-uri>:latest
```

After successfully pushing the image to ECR, create a new task definition first then a service within AWS ECS.

Remember to add the environment variables, (if applicable) health check route (`/health`), and set the port to 8081.
