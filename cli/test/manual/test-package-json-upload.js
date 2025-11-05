#!/usr/bin/env node

import { readFileSync } from 'fs';

async function testPackageJsonUpload() {
  try {
    console.log('📤 Testing package.json upload to local API...\n');

    const packageJsonPath = './package.json';
    const fileContent = readFileSync(packageJsonPath);

    console.log(`File: package.json`);
    console.log(`Size: ${(fileContent.length / 1024).toFixed(2)} KB\n`);

    // Create FormData
    const formData = new FormData();
    const blob = new Blob([fileContent], { type: 'application/json' });
    formData.append('lockfile', blob, 'package.json');

    console.log('Sending POST request to http://localhost:3000/api/scan...\n');

    const response = await fetch('http://localhost:3000/api/scan', {
      method: 'POST',
      body: formData,
    });

    console.log(`Response status: ${response.status} ${response.statusText}\n`);

    const data = await response.json();

    if (!response.ok) {
      console.log('❌ Upload failed!');
      console.log('Error:', data);
      process.exit(1);
    } else {
      console.log('✅ Upload successful!');
      console.log(`Dependencies found: ${data?.results?.deps?.length || 0}`);
      console.log('\nFirst 5 dependencies:');
      data.results.deps.slice(0, 5).forEach(dep => {
        console.log(`  - ${dep.name}@${dep.version}`);
      });
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    process.exit(1);
  }
}

testPackageJsonUpload();
