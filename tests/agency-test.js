// node tests/agency-test.js
const assert=require('assert');
const {PARTS,MATS}=require('../src/sim.js');
const A=require('../src/agency.js');
assert.strictEqual(A.designSpace(PARTS,MATS),14112,'design space');
assert.strictEqual(A.cleanAgency({field:'javascript:1',emblem:'skull',name:'<b>X</b>'}).field,A.AGENCY_DEFAULT.field);
assert.strictEqual(A.cleanAgency({emblem:'skull'}).emblem,A.AGENCY_DEFAULT.emblem);
assert.strictEqual(A.cleanAgency({name:'<b>Hi</b>'}).name,'bHi/b');
assert.strictEqual(A.cleanAgency({name:'x'.repeat(40)}).name.length,24);
assert.strictEqual(A.cleanAgency({field:'#ABCDEF'}).field,'#abcdef');
assert.strictEqual(A.cleanAgency(null).name,'Nitro Gravity');
assert.ok(Math.abs(A.contrastRatio('#000000','#ffffff')-21)<1e-9);
assert.strictEqual(A.escHtml('<a href="x">&\'</a>'),'&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
console.log('agency tests passed');
