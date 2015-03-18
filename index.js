var through = require('through2');

module.exports = Deploy;

function Deploy (opts) {
    if (!(this instanceof Deploy)) return new Deploy(opts);
    var self = this;

    var git = require('git-rev');
    git.branch(function (branch) {
        if (!opts.bucket) {
            opts.bucket = branch;
        }

        var m;
        if (opts.bucket === 'master') {
            m = [
                'On the master branch.\n',
                'Deploying to the the webhook ',
                'managed server.'
            ];
            console.log(m.join(''));

            whDeploy();
        } else {
            m = [
                'On ',
                branch,
                ' branch.\n',
                'Deploying to an AWS S3 bucket.'
            ];
            console.log(m.join(''));

            // If opts.bucket is set,
            // use it for the branch

            s3Deploy(opts);
        }
    });

}

function whDeploy () {
    var spawn = require('child_process').spawn;
    var wh = spawn('wh', ['deploy'], { cwd: process.cwd() });
    
    wh.stdout.pipe(process.stdout);
    wh.stderr.pipe(process.stderr);
}

function s3Deploy (opts) {
    var fs = require('fs');
    var spawn = require('child_process').spawn;
    var from = require('from2-array');

    var aws = require('aws-sdk');

    console.log('Running Deploy');

    console.log('Configure AWS.');
    aws.config.update({ accessKeyId: opts.aws.key,
                        secretAccessKey: opts.aws.secret });
    var awsS3 = new aws.S3();
    var s3 = require('s3');

    if (!(opts.prefix)) {
        throw new Error('Requires a prefix for the bucket');
    }

    from.obj([{
            bucketPrefix:  opts.prefix + '-',
            rawBucketName: opts.bucket,
            bucketName:    false,
            bucket:        false,
            websiteConig:  false,
            policyConfig:  false,
            s3Client:      false,
            sync:          false
        }])
        .pipe(MakeBucketName())
        .pipe(CreateBucketWithS3(awsS3))
        .pipe(SetWebsiteConfigWithS3(awsS3))
        .pipe(SetBucketPolicyWithS3(awsS3))
        .pipe(InitializeS3Client(s3, opts.aws))
        .pipe(Build(spawn))
        .pipe(SyncDirectory())
        .pipe(CleanUp(spawn))
        .pipe(OpenUrl(spawn))
        .pipe(CopyUrl(spawn))
        .pipe(loggify());
}


function MakeBucketName () {
    return through.obj(toUrl);
    function toUrl (conf, enc, next) {
        conf.bucketName = conf.bucketPrefix +
                          conf.rawBucketName
                              .toLowerCase()
                              .replace(/\//g, '-');
        this.push(conf);
        next();
    }
}

function CreateBucketWithS3 (s3) {
    var params = {
        ACL: 'public-read'
    };

    return through.obj(createBucket);

    function createBucket (conf, enc, next) {
        var m = [
            'Creating S3 bucket for static hosting'
        ];
        console.log(m.join(''));

        var self = this;
        if (conf.bucketName === false) {
            var e = [
                'Creating S3 bucket requires ',
                'a name, in this case, the ',
                'current git branch.'
            ];
            throw new Error(e.join(''));
        } else {
            params.Bucket = conf.bucketName;
            s3.createBucket(params, finish);
        }

        function finish (err, data) {
            if (err) {
                console.log(err, err.stack);
                throw new Error('Error creating bucket.');
            } else {
                conf.bucket = data.Location;
            }
            self.push(conf);
            next();
        }
    }
}

function SetWebsiteConfigWithS3 (s3) {
    var params = {
        WebsiteConfiguration: {
            IndexDocument: { Suffix: 'index.html' },
            ErrorDocument: { Key: '404.html' }
        }
    };
    function url (bucketName) {
        return [
            'http://',
            bucketName,
            '.s3-website-us-east-1.amazonaws.com'
        ].join('');
    }

    return through.obj(websiteConig);

    function websiteConig (conf, enc, next) {
        var self = this;

        var m = [
            'Configuring S3 bucket for static hosting.'
        ];
        console.log(m.join(''));

        if (conf.bucket === false) {
            var e = [
                'Requires a bucket to have been made ',
                'before it can be configured for ',
                'static hosting.'
            ];
            throw new Error(e.join(''));
        } else {
            params.Bucket = conf.bucketName;
            s3.putBucketWebsite(params, finish);
        }

        function finish (err, data) {
            if (err) {
                console.log(err);
                console.log(err.stack);
                throw new Error(err);
            } else {
                conf.websiteConfig = params;
                conf.url = url(conf.bucketName);
            }
            self.push(conf);
            next();
        }
    }
}

function SetBucketPolicyWithS3 (s3) {
    function params (bucketName) {
        var p = {
            "Version": "2012-10-17",
            "Statement": [{
                "Sid": "PublicReadGetObject",
                "Effect": "Allow",
                "Principal": "*",
                "Action": ["s3:GetObject"],
                "Resource": ["arn:aws:s3:::" +
                              bucketName +"/*"]
            }]
        };

        return {
            Bucket: bucketName,
            Policy: JSON.stringify(p)
        };
    }

    return through.obj(plcy);

    function plcy (conf, enc, next) {
        var self = this;

        var m = [
            'Configuring S3 bucket policy for hosting.'
        ];
        console.log(m.join(''));

        if (conf.bucket === false) {
            var e = [
                'Requires a bucket to have been made ',
                'before it can be configured for ',
                'static hosting.'
            ];
            throw new Error(e.join(''));
        } else {
            conf.policyConfig = params(conf.bucketName);
            s3.putBucketPolicy(
                    conf.policyConfig,
                    finish);
        }

        function finish (err, data) {
            if (err) {
                conf.policyConfig = false;
                console.log(err);
                console.log(err.stack);
                throw new Error(err);
            }
            self.push(conf);
            next();
        }
    }
}

function InitializeS3Client (s3, aws) {
    return through.obj(initS3Client);

    function initS3Client (conf, enc, next) {
        if (conf.bucketName === false) {
            var e = [
                'The s3 client requires a ',
                'bucket name to initialize.'
            ];
            throw new Error(e.join(''));
        } else {
            conf.s3Client =
                s3.createClient({
                    s3Options: {
                        accessKeyId: aws.key,
                        secretAccessKey: aws.secret
                    }
                });

            this.push(conf);
            next();
        }
    }
}

function Build (spawn) {
    return through.obj(bld);

    function bld (conf, enc, next) {
        var build = spawn(
                        'grunt',
                        ['build'],
                        { cwd: process.cwd() });
        
        var self = this;
        build.stdout.on('data', function (d) {
            console.log('stdout: ', d.toString());
        });
        build.stderr.on('data', function (d) {
            console.log('stderr: ', d.toString());
        });
        build.on('close', function () {
            self.push(conf);
            next();
        });
    }
}

function SyncDirectory () {
    return through.obj(sync);

    function sync (conf, enc, next) {
        console.log('Syncing .build directory with S3');
        var self = this;
        var params = {
            localDir: process.cwd() + '/.build',
            s3Params: {
                Bucket: conf.bucketName,
                Prefix: ''
            }
        };
        var uploader = conf.s3Client.uploadDir(params);
        var factionInterval = 0;
        uploader.on('error', function (err) {
            console.error(err);
        });
        uploader.on('progress', function () {
            if (uploader.progressAmount > 0) {
                if (uploader.progressAmount ===
                    uploader.progressTotal) {
                    conf.sync = true;
                }
            }
        });
        uploader.on('end', function () {
            self.push(conf);
            next();
        });
    }
}


function CleanUp (spawn) {
    return through.obj(clnp);

    function clnp (conf, enc, next) {
        var cleaner = spawn(
                        'grunt',
                        ['clean'],
                        { cwd: process.cwd() });
        
        var self = this;
        cleaner.stdout.on('data', function (d) {
            console.log('stdout: ', d.toString());
        });
        cleaner.stderr.on('data', function (d) {
            console.log('stderr: ', d.toString());
        });
        cleaner.on('close', function () {
            self.push(conf);
            next();
        });
    }
}

function OpenUrl (spawn) {
    return through.obj(opn);

    function opn (conf, enc, next) {
        var opener = spawn(
                        'open',
                        [conf.url],
                        { cwd: process.cwd() });
        
        var self = this;
        opener.stdout.on('data', function (d) {
            console.log('stdout: ', d.toString());
        });
        opener.stderr.on('data', function (d) {
            console.log('stderr: ', d.toString());
        });
        opener.on('close', function () {
            self.push(conf);
            next();
        });
    }
}

function CopyUrl (spawn) {
    return through.obj(cpyurl);

    function cpyurl (conf, enc, next) {
        var pbcopy = spawn('pbcopy');
        pbcopy.stdin.write(conf.url);
        pbcopy.stdin.end();
        
        this.push(conf);
        next();
    }
}

function loggify () {
    return through.obj(write, end);

    function write (row, enc, next) {
        console.log(row);
        this.push(row);
        next();
    }

    function end () { this.push(null); }
}