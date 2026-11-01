import assert from 'node:assert/strict';
import {runClientLoop} from './reading-client-loop.mjs';
import {rarSolidSample} from '../server/reading/rar-solid-fixtures.mjs';
import {readMaterial} from '../server/reading/material.mjs';
export async function runRarSolidClients({directory,version,reader}) {
    const { body, packed } = await rarSolidSample(version);
    return await runClientLoop({
      directory,
      reader: reader || Object.assign((f, o) => readMaterial(f, o), { archiveWindows: true, pdfWindows: true }),
      sourceByMini: true, startByMini: true, reviseAfterPublication: true,
      ...(version === 4 ? { originalQuota: 1, expireBeforeStart: true } : { deleteBeforeStart: true }),
      original: {
        name: `真实共享字典RAR${version}.rar`, type: "application/octet-stream", body,
        tailText: "file9\n",
        verify({ win, mini }) {
          const a = win.readingCoverage[0], b = mini.readingCoverage[0];
          assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
          assert.equal(a.state, "read");
          assert.deepEqual(a.covered.map(r => r.archivePath), Array.from({length:9}, (_,i) => `file${i+1}.txt`));
          assert.equal(a.archiveCompression.packedBytes, packed);
          assert.equal(a.archiveCompression.expandedBytes, 54);
          assert.equal(a.archiveCompression.blocks[0].members, 9);
          assert.equal(a.archivePagination.next, null);
        },
      },
    });

}
