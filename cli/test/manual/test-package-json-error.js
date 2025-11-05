#!/usr/bin/env node

import { readFileSync } from 'fs';

async function testPackageJsonError() {
  try {
    console.log('📤 Testing package.json upload (should show helpful error)...\n');

    const fileContent = readFileSync('./package.json');
    const formData = new FormData();
    const blob = new Blob([fileContent], { type: 'application/json' });
    formData.append('lockfile', blob, 'package.json');

    console.log('Sending POST request to http://localhost:3000/api/scan...\n');

    const response = await fetch('http://localhost:3000/api/scan', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    console.log(`Response status: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      console.log('✅ Got expected error response!');
      console.log('\nError message:');
      console.log(data.message);

      // Check if the error message is helpful
      if (data.message.includes('lockfile') && data.message.includes('resolution')) {
        console.log('\n✅ Error message is helpful and guides users to upload lockfiles!');
      } else {
        console.log('\n⚠️  Error message could be more helpful');
      }
    } else {
      console.log('❌ Should have failed but succeeded');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    process.exit(1);
  }
}

testPackageJsonError();
