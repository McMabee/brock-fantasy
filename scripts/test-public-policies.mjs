import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';

const directories = ['apps/client/public', '../brock-fantasy-association/public'];
const files = (await readdir('docs/policies'))
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .map((name) => name.replace(/\.md$/u, '.html'));
assert.equal(files.length, 14);
for (const directory of directories) {
  const documents = new Map(
    await Promise.all(
      files.map(async (name) => [
        name,
        await readFile(path.join(directory, 'policies', name), 'utf8'),
      ]),
    ),
  );
  for (const [name, html] of documents) {
    const $ = load(html);
    assert.equal($('h1').length, 1, name);
    assert.equal($('main#bf-main article.policy-content').length, 1, name);
    assert.doesNotMatch(
      $('body').text(),
      /Tarik|copied internally|Unapproved policy draft|\[insert|Draft for operator publication/u,
      name,
    );
    assert.ok($('footer a[href="mailto:tymabee@proton.me"]').length, name);
    for (const anchor of $('article a[href]').toArray()) {
      const href = $(anchor).attr('href');
      if (/^(?:https:|mailto:|\/)/u.test(href)) continue;
      const [target, fragment] = href.split('#');
      const linked = documents.get(target || name);
      assert.ok(linked, `${name}: missing ${target}`);
      if (fragment)
        assert.ok(load(linked)(`[id="${fragment}"]`).length, `${name}: missing ${href}`);
    }
    for (const file of [
      '/ui/policies.css',
      '/ui/policy-theme.js',
      '/ui/privacy.js',
      '/ui/privacy.css',
      '/policy-fonts.css',
    ])
      assert.ok((await readFile(path.join(directory, file.slice(1)))).length, file);
  }
}
for (const name of files)
  assert.equal(
    await readFile(path.join(directories[0], 'policies', name), 'utf8'),
    await readFile(path.join(directories[1], 'policies', name), 'utf8'),
    name,
  );
console.log(
  'All 14 policies match across both sites with valid links, headings, assets and public contact wording',
);
