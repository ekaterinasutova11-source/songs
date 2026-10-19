import fs from 'node:fs';
const index='secrets/selectel-2026-10-20/deploy/site/index.html';
const notice='<p role="status" style="padding:12px;text-align:center;background:#fff2d6;color:#493715;margin:0">Проверка переноса: библиотека доступна для чтения. Изменения пока вносите на прежнем сайте.</p>';
fs.writeFileSync(index,fs.readFileSync('index.html','utf8').replace('<body>','<body>\n'+notice));
const key=fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
fs.writeFileSync('secrets/Selectel-test-link.txt','Проверка новой библиотеки (пока только чтение):\nhttps://135.106.183.211/#/t/'+key+'\n');
console.log('Staging notice and private test link prepared');
