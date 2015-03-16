# WH S3 Branch Deploy

A utility module for deploying WebHook projects to S3 static site, informed by the current git branch.

Run this command while on `master` branch, and `wh deploy` will be executed.

Run this command while on any other branch, and the S3 deploy will be executed.


### Piggyback on WebHook

S3 deploy will run `grunt build`, and sync the resulting `.build`  directory to an S3 bucket that is named after the current git branch, or defined bucket.

For example. You are working on `feature/apiIntegration` of `bigProject`. Running `wh-s3-branch-deploy` from the root of your WebHook project will build your project, and sync your `.build` directory to a an S3 bucket named `bigProject-feature-apiIntegration`, and will give you a URL to visit your site: `bigProject-feature-apiIntegration.s3.amazonaws.com`.

`wh` is a peer dependency. As it will rung `wh deploy` or `wh build` on yourbehalf.


### Install

`npm install wh-s3-branch-deploy`


### Usage

Requires AWS credentials & a prefix.

```JavaScript
var Deploy = require('wh-s3-branch-deploy');
var opts = { aws: { key: '', secret: '' },
			 prefix: '' };

Deploy(opts);
```

Optionally, you can add a `bucket` key to your options to use to define your own bucket to deploy to, instead of one based on the current git branch.

```
var opts = { aws: { key: '', secret: '' },
			 prefix: '',
			 bucket: '' };
```

