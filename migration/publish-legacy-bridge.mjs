// Publish only a compatibility redirect to GitHub Pages. Main stays the source repository.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {github} from './github-pages.mjs';
const git=(args,input)=>execFileSync('git',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const branch='codex/pages-redirect';
const before=await github('/pages');
fs.mkdirSync('secrets/frontend-move',{recursive:true});
fs.writeFileSync('secrets/frontend-move/pages-before.json',JSON.stringify(before,null,2),{flag:'wx'});
const html=fs.readFileSync('migration/legacy-site/index.html');
const blob=git(['hash-object','-w','--stdin'],html);
const empty=git(['hash-object','-w','--stdin'],'');
const tree=git(['mktree'],`100644 blob ${empty}\t.nojekyll\n100644 blob ${blob}\t404.html\n100644 blob ${blob}\tindex.html\n`);
const commit=git(['commit-tree',tree,'-m','Keep existing Songs links working through Selectel redirect']);
// A new ref is required: never force-update an existing user branch.
git(['update-ref',`refs/heads/${branch}`,commit,'0000000000000000000000000000000000000000']);
git(['push','origin',`refs/heads/${branch}`]);
await github('/pages',{method:'PUT',body:JSON.stringify({build_type:'legacy',source:{branch,path:'/'}})});
const after=await github('/pages');
console.log(JSON.stringify({source:after.source,redirectCommit:commit,url:after.html_url}));
