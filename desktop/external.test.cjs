const { test } = require('node:test');
const assert = require('node:assert/strict');
const { externalWebUrl } = require('./external.cjs');
test('external links only open web URLs and never executable/local schemes', () => {
  assert.equal(externalWebUrl('https://example.com/a?b=1'),'https://example.com/a?b=1');
  for(const url of ['javascript:alert(1)','file:///C:/Windows/test.exe','data:text/html,test','ms-settings:','shixu://app/','https://user:pass@example.com'])assert.equal(externalWebUrl(url),'');
});
