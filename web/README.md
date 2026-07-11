# Next.js App

## Development

To run the development server, execute the following command in the terminal:

```bash
npm install # install dependencies
npm run dev
```

Then navigate to `http://localhost:3000` in your web browser to view the
application.

## Production + Deployment

To build Docker image and push to AWS ECR, run the following commands in the
terminal:

```bash
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <aws-ecr-uri>
docker build --secret id=env,src=.env -t <ecr-repo-name> .
docker tag <ecr-repo-name>:latest <aws-ecr-repo-uri>:latest
docker push <aws-ecr-repo-uri>:latest
```

Note that environment variables will still need to be set in AWS and remember to
set the port to 3000 as well.
