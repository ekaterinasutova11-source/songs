import fs from 'node:fs';
const report={
  completedAt:new Date().toISOString(),
  site:'https://ekaterinasutova11-source.github.io/songs/',api:'https://135.106.183.211/api',
  readOnly:false,oldLinksPreserved:true,legacyApiForwardsToSelectel:true,staleGoogleFallbackDisabled:true,
  sourceReconciliation:JSON.parse(fs.readFileSync('outputs/selectel-cutover-reconciliation.json')),
  httpsVerification:JSON.parse(fs.readFileSync('outputs/selectel-live-verification.json')),
  publication:JSON.parse(fs.readFileSync('outputs/selectel-publication.json')),
  browser:{
    directSelectel:{song:'Happy',variants:['minus','original'],durationSeconds:[171.916168,232.127278],seekFractions:[0.5,0.9],continuedAfterSeek:true,backFiveSeconds:true,audioErrors:0},
    existingPupilLink:{song:'A Thousand Years',durationSeconds:287.750227,beforeSeekSeconds:14.917203,seekFraction:0.6,afterSeekAndPlaybackSeconds:201.39049,mediaOrigin:'https://135.106.183.211',readyState:4,audioErrors:0,deepLinkSurvivesReload:true},
    existingTeacherLink:{studentCards:11,module:'app.js?v=selectel1'},physicalPhonesTested:false,
  },
  liveMutationSmoke:{uploads:true,text:true,metadata:true,copy:true,rename:true,delete:true,keyRevocation:true,temporarySpacesDeleted:true,realLibraryUnchanged:true},
  tests:{passed:69,failed:0},
};
fs.writeFileSync('outputs/selectel-cutover-verification.json',JSON.stringify(report,null,2));
const key=fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
fs.writeFileSync('secrets/Selectel-test-link.txt','Личная ссылка преподавателя. Загрузки и правки включены.\nhttps://135.106.183.211/#/t/'+key+'\n\nПрежняя ссылка также работает:\nhttps://ekaterinasutova11-source.github.io/songs/#/t/'+key+'\n');
console.log(JSON.stringify({cutover:'complete',oldLinksPreserved:true,spaces:11,files:233}));
