#!/usr/bin/env node
// Patches Expo's CORS middleware to allow Replit proxy domains (.replit.dev, .repl.co)
// This is required because Replit previews are served through a proxied iframe,
// and Metro's host check would otherwise block all requests.

const fs = require('fs');
const path = require('path');

const filePath = path.resolve(
  __dirname,
  '../node_modules/@expo/cli/build/src/start/server/middleware/CorsMiddleware.js'
);

if (!fs.existsSync(filePath)) {
  console.log('[patch-expo-cors] CorsMiddleware.js not found, skipping patch.');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('replit.dev')) {
  console.log('[patch-expo-cors] Patch already applied, skipping.');
  process.exit(0);
}

const oldFn = `const _isLocalHostname = (hostname)=>{
    if (hostname === 'localhost') {
        return true;
    }`;

const newFn = `const _isLocalHostname = (hostname)=>{
    if (hostname === 'localhost') {
        return true;
    }
    // Allow Replit proxy domains
    if (hostname.endsWith('.replit.dev') || hostname.endsWith('.repl.co') || hostname.endsWith('.riker.replit.dev')) {
        return true;
    }`;

if (!content.includes(oldFn)) {
  console.warn('[patch-expo-cors] Expected pattern not found in CorsMiddleware.js. The patch may need updating for this version of @expo/cli.');
  process.exit(0);
}

content = content.replace(oldFn, newFn);
fs.writeFileSync(filePath, content, 'utf8');
console.log('[patch-expo-cors] Patch applied successfully.');
