#!/usr/bin/env node
const fs=require('fs'),vm=require('vm');
const root=__dirname+'/..';
const qsrc=fs.readFileSync(root+'/assets/js/qrcode-generator.js','utf8');
const ctx={console};vm.createContext(ctx);vm.runInContext(qsrc,ctx);
const ok=(name,cond)=>{if(!cond)throw new Error(name);console.log('OK  - '+name)};
if(typeof ctx.qrcode!=='function')throw new Error('vendored QR encoder not available');
const qr=ctx.qrcode(0,'M');qr.addData(JSON.stringify({id:'ADM/2026/001',name:'Student Example',type:'student'}));qr.make();
ok('vendored QR encoder creates a local scannable matrix',qr.getModuleCount()>=21&&qr.createSvgTag(3,12).startsWith('<svg'));
ok('QR output is self-contained and data-URI encoded',qr.createDataURL(3,12).startsWith('data:image/')&&!/api\.qrserver\.com/.test(qr.createDataURL(3,12)));
const page=fs.readFileSync(root+'/idcards.html','utf8'),superJs=fs.readFileSync(root+'/assets/js/super.js','utf8');
ok('ID card page exposes ID-1/2/3, custom mm, orientation, paired and duplex modes',['value="id1"','value="id2"','value="id3"','ic-card-width-mm','ic-card-height-mm','ic-card-orientation','ic-paper-width-mm','value="paired"','value="duplex"'].every(x=>page.includes(x)));
ok('Every student print unit has fixed mm dimensions and explicit page-break boundaries',page.includes(`.idcard-print-sheet{width:'+cfg.contentWidth+'mm`)&&page.includes('break-after:always')&&page.includes(`style="width:'+cfg.width+'mm;height:'+cfg.height+'mm`)&&page.includes('window.print()'));
ok('Single and bulk print use the same bounded front/back sheet builder',page.includes('print(){return this.printCards([this.person()]')&&page.includes('return this.printCards(people')&&superJs.includes('window.ICUI.printCards([person]'));
ok('Direct ID-card callers use the fixed physical card print path',superJs.includes('window.ICUI.printCards([person]')&&superJs.includes('85.6mm')&&superJs.includes('53.98mm'));
ok('Local QR encoder loads before Super creates card markup',page.indexOf('assets/js/qrcode-generator.js')>=0&&page.indexOf('assets/js/qrcode-generator.js')<page.indexOf('assets/js/super.js'));
ok('Global popup toasts remain above modal overlays',fs.readFileSync(root+'/assets/css/style.css','utf8').includes('z-index:2147483647!important'));
console.log('ID card print tests: 8 passed');
