const { ProfileStore } = require('../dist/profile/index.js');
const { ProfileService } = require('../dist/auth/profileService.js');

async function testCreateFromConfig() {
  try {
    console.log('Testing create profile from config...');
    
    const store = new ProfileStore();
    await store.initialize();
    
    const profileService = new ProfileService(store);
    const result = await profileService.createProfileFromConfig('test-config-profile');
    
    if (result.success) {
      console.log('✓ Profile created successfully');
      console.log(`  Providers: ${result.providers?.join(', ') || 'none'}`);
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testCreateFromConfig();

