'use strict';

/**
 * Minimal in-memory S3 stand-in for managed cloud backup tests.
 */
function createInMemoryS3Store() {
  /** @type {Map<string, Buffer>} */
  const objects = new Map();
  return {
    objects,
    reset() {
      objects.clear();
    },
  };
}

function createInMemoryS3Client(store, creds) {
  return {
    async send(command) {
      const input = command.input || command;
      const name = command.constructor && command.constructor.name;
      const bucket = input.Bucket;
      const key = input.Key;
      if (name === 'PutObjectCommand') {
        if (bucket !== creds.bucket) throw new Error('NoSuchBucket');
        store.objects.set(key, Buffer.from(input.Body));
        return {};
      }
      if (name === 'GetObjectCommand') {
        const body = store.objects.get(key);
        if (!body) {
          const err = new Error('The specified key does not exist.');
          err.name = 'NoSuchKey';
          throw err;
        }
        return {
          Body: (async function* () {
            yield body;
          })(),
        };
      }
      if (name === 'ListObjectsV2Command') {
        const prefix = input.Prefix || '';
        const contents = [];
        for (const [k, v] of store.objects.entries()) {
          if (k.startsWith(prefix)) contents.push({ Key: k, Size: v.length, LastModified: new Date() });
        }
        return { Contents: contents };
      }
      throw new Error('Unsupported command ' + name);
    },
  };
}

module.exports = { createInMemoryS3Store, createInMemoryS3Client };
