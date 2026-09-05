#!/usr/bin/env node
/**
 * Upload release artifacts to Firebase Storage using Application Default Credentials.
 * Usage: node scripts/upload-release.mjs <localPath> <storagePath>
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../functions/package.json'));
const admin = require('firebase-admin');

const [localPath, storagePath] = process.argv.slice(2);
if (!localPath || !storagePath) {
	console.error('Usage: node scripts/upload-release.mjs <localPath> <storagePath>');
	process.exit(1);
}

if (!fs.existsSync(localPath)) {
	console.error(`File not found: ${localPath}`);
	process.exit(1);
}

admin.initializeApp({
	storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.GCLOUD_STORAGE_BUCKET || undefined,
});
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || admin.app().options.storageBucket;
if (!bucketName) {
	console.error('Set FIREBASE_STORAGE_BUCKET (e.g. singularity-ide.firebasestorage.app)');
	process.exit(1);
}
const bucket = admin.storage().bucket(bucketName);
const contentType = localPath.endsWith('.zip')
	? 'application/zip'
	: localPath.endsWith('.json')
		? 'application/json'
		: localPath.endsWith('.dmg')
			? 'application/x-apple-diskimage'
			: 'application/octet-stream';

await bucket.upload(localPath, {
	destination: storagePath,
	metadata: { contentType, cacheControl: 'public, max-age=3600' },
});

const encoded = encodeURIComponent(storagePath);
const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;
console.log(JSON.stringify({ storagePath, url, bucket: bucket.name }));
