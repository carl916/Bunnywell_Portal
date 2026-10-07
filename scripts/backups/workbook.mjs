import ExcelJS from 'exceljs';

const colour = { ink:'243F36', header:'315448', pale:'F2F5F3', amber:'FFF0CC', link:'17618A' };
const moneyFormat = '"£"#,##0.00;[Red]("£"#,##0.00)';
const formats = { money:moneyFormat, date:'dd mmm yyyy', timestamp:'dd mmm yyyy hh:mm', percent:'0.00%', number:'#,##0' };
const c = (key,title,width=22,type='text') => ({ key,title,width,type });
const place = [c('building','Building',24),c('floor','Floor',16),c('unit','Unit',12)];
const id = c('id','Record ID',38);
const link = (url,text='Open') => url ? { text, hyperlink:url, tooltip:text } : '';

function table(book,name,columns,rows,context) {
  if (rows.length > 1048570) throw new Error(`${name} exceeds Excel's row limit; export stopped.`);
  const sheet = book.addWorksheet(name, { views:[{state:'frozen',ySplit:4,xSplit:Math.min(3,columns.length-1),showGridLines:false}], properties:{defaultRowHeight:24} });
  sheet.columns = columns.map(col => ({key:col.key,width:col.width}));
  sheet.getCell('A1').value = name; sheet.getCell('A1').font = {name:'Arial',size:17,bold:true,color:{argb:colour.ink}};
  sheet.getCell('A2').value = context; sheet.getCell('A2').font = {name:'Arial',size:10,color:{argb:'617169'}};
  sheet.mergeCells(2,1,2,columns.length); sheet.getCell('A2').alignment={vertical:'middle',wrapText:true};
  sheet.getRow(1).height=27; sheet.getRow(2).height=32;
  const header=sheet.getRow(4); header.values=columns.map(col=>col.title); header.height=36;
  header.eachCell(cell=>{cell.font={name:'Arial',size:10,bold:true,color:{argb:'FFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:colour.header}};cell.alignment={vertical:'middle',wrapText:true};});
  rows.forEach((row,i)=>{
    const line=sheet.getRow(i+5); let lines=1;
    columns.forEach((col,j)=>{
      let value=row[col.key] ?? '';
      if (typeof value==='boolean') value=value?'Yes':'No';
      if (value!=='' && ['date','timestamp'].includes(col.type)) { value=new Date(value);if(!Number.isFinite(value.getTime()))throw new Error(`Invalid date in ${name}`); }
      if(typeof value==='string') { if(value.length>32767)throw new Error(`Text exceeds Excel cell capacity in ${name}; export stopped.`);lines=Math.max(lines,...value.split('\n').map(part=>Math.ceil(part.length/col.width)),value.split('\n').length); }
      const cell=line.getCell(j+1);cell.value=value === '' ? null : value;cell.font={name:'Arial',size:10,color:{argb:colour.ink}};
      cell.alignment={vertical:'top',wrapText:true,horizontal:['money','number','percent'].includes(col.type)?'right':'left'};
      if(formats[col.type])cell.numFmt=formats[col.type];
      if(i%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:colour.pale}};
      if(value?.hyperlink)cell.font={name:'Arial',size:10,color:{argb:colour.link},underline:true};
      if(col.key==='overdue' && value)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:colour.amber}};
    });
    line.height=Math.min(180,Math.max(27,lines*14+10));
  });
  sheet.autoFilter={from:{row:4,column:1},to:{row:Math.max(4,rows.length+4),column:columns.length}};
  sheet.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,paperSize:9,printTitlesRow:'1:4'};
  sheet.headerFooter.oddFooter='Bunnywell | Snapshot export | Page &P of &N';
  return sheet;
}

export async function writeWorkbook(model,file) {
  const book=new ExcelJS.Workbook();book.creator='Bunnywell Portal';book.created=new Date(model.snapshot);book.modified=new Date(model.snapshot);
  const context=`${model.environment==='production'?'Production':'Validation'} snapshot: ${model.snapshot} · Times are UTC · Internal use`;
  const docRows=new Map();model.references.forEach((r,i)=>{for(const key of [r.id,r.parentId,r.saleId,...(r.relatedSnags||'').split(', ')])if(key&&!docRows.has(key))docRows.set(key,i+5);});
  const evidence=key=>docRows.has(key)?link(`#'Documents'!A${docRows.get(key)}`,'Documents / evidence'):'';
  table(book,'Start here',[c('item','Item',33),c('value','Details',105)],[
    {item:'Snapshot captured',value:model.snapshot},
    {item:'Sales units / snags',value:`${model.sales.length} units; ${model.snags.length} snags; ${model.snags.filter(s=>s.status!=='Closed').length} open snags`},
    {item:'Files included',value:`${model.references.filter(r=>r.relative).length} file references. External links: ${model.references.filter(r=>r.external).length}.`},
    {item:'Needs attention',value:link("#'Needs attention'!A1",`${model.exceptions.length} items to review`)},
    {item:'Sales progression',value:link("#'Sales progression'!A1",'Open sales progression')},
    {item:'Snags',value:link("#'Snags'!A1",'Open snags')},
    {item:'Using files offline',value:'Extract the complete ZIP before opening the workbook. Keep the files folder beside this workbook. Open backup links work without the portal or Supabase. In Dropbox, download the ZIP or sync the entire dated folder.'},
    {item:'Continuing work',value:'Copy Working log.xlsx to a separate working folder and record actions, owners, dates and evidence there. Keep this snapshot unchanged. A later backup will never overwrite your working copy.'},
    {item:'Returning to the portal',value:'Review working-log changes against current records before entering them in the portal. Spreadsheet edits do not update the portal or issue legal authority.'},
    {item:'Snapshot limits',value:'Status and next actions are as at the snapshot. Check expiry and due dates before acting. External links are not backed up. Earlier download-only reports may not have been saved centrally.'},
    {item:'Document history',value:'Current and superseded non-redacted document versions are indexed separately. An approval applies only to its recorded document version. Temporary upload-session files are not issued documents.'},
    {item:'Payments',value:'Payment schedules are expected amounts, not receipt evidence. Deposit corrections are revisions, not extra receipts. Voided invoice payments are retained but excluded from invoice paid totals.'},
    {item:'Access',value:'This internal workbook contains buyer and operational contact details. Keep it and its files inside the restricted backup folder. Do not distribute the master workbook to external parties.'},
    {item:'Source',value:model.portalUrl},
  ],context);
  table(book,'Needs attention',[...place,id,c('issue','Needs attention',75)],model.exceptions,context);
  table(book,'Sales progression',[...place,c('status','Unit status',18),c('stage','Sales stage',23),c('action','Next action',38),c('owner','Responsible party',25),c('completionDue','Completion due',18,'date'),c('statement','Completion statement',27),c('account','Statement of account',27),c('authorityStatus','Exchange authority',22),c('authorityExpiry','Authority expiry (UTC)',24,'timestamp'),c('evidence','Evidence',24),c('live','Live sale file',23),c('saleId','Sale ID',38),c('unitId','Unit ID',38)],
    model.sales.map(r=>({...r,evidence:evidence(r.saleId),live:link(r.liveUrl,'Open live sale file')})),context);
  table(book,'Sales details',[...place,c('buyer','Buyer',28),c('email','Buyer email',33),c('phone','Buyer phone',22),c('agent','Sales agent',30),c('solicitor','Solicitor',30),c('solicitorEmail','Solicitor email',33),c('solicitorPhone','Solicitor phone',22),c('price','Contract price',21,'money'),c('reservation','Reservation date',19,'date'),c('exchange','Exchange date',19,'date'),c('deposit','Deposit received',22,'money'),c('depositDate','Deposit receipt date',19,'date'),c('notice','Notice issued',19,'date'),c('completion','Legal completion (UTC)',24,'timestamp'),c('handover','Handover',19,'date'),c('lastUpdate','Last updated (UTC)',24,'timestamp'),c('saleId','Sale ID',38)],model.sales,context);
  table(book,'Commercial terms',[...place,c('version','Terms version',14,'number'),c('current','Current version',14),c('status','Status',18),c('price','Contract price',21,'money'),c('reservationFee','Reservation fee',21,'money'),c('holder','Fee holder',20),c('parking','Parking value',21,'money'),c('developerContribution','Developer contribution',23,'money'),c('agentContribution','Agent contribution',23,'money'),c('otherConcessions','Other concessions',21,'money'),c('agentFeePercent','Agent fee',16,'percent'),c('solicitorFee','Solicitor fee',21,'money'),c('summary','Commercial summary',55),c('schedule','Payment structure',55),c('specialTerms','Special conditions',65),c('approvedBy','Approved by',28),c('approvedAt','Approved at (UTC)',24,'timestamp'),id,c('saleId','Sale ID',38)],model.terms,context);
  const paymentSheet=table(book,'Payments and fees',[...place,c('kind','Record type',34),c('reference','Reference',28),c('status','Status',36),c('expected','Expected / payable',22,'money'),c('received','Recorded received / paid',23,'money'),c('balance','Invoice balance',22,'money'),c('date','Date',18,'date'),c('organisation','Organisation',30),c('actor','Recorded by',28),c('notes','Notes',60),id,c('saleId','Sale ID',38)],model.payments,context);
  model.payments.forEach((r,i)=>{if(r.balance!=null)paymentSheet.getCell(i+5,9).value={formula:`G${i+5}-H${i+5}`,result:r.balance};});
  table(book,'Snags',[...place,c('area','Room / communal area',27),c('title','Snag',40),c('status','Status',22),c('action','Next action',40),c('priority','Priority',12),c('contractor','Assigned organisation',30),c('owner','Assigned person',27),c('due','Deadline (UTC)',24,'timestamp'),c('overdue','Overdue',15),c('evidence','Evidence',24),c('description','Description',65),c('trade','Trade',23),c('latest','Latest update',65),c('created','Raised (UTC)',24,'timestamp'),c('updated','Updated (UTC)',24,'timestamp'),c('closed','Closed (UTC)',24,'timestamp'),c('source','Source',23),id],model.snags.map(r=>({...r,evidence:evidence(r.id)})),context);
  table(book,'Documents',[...place,c('kind','Document / media type',28),c('name','Filename / description',48),c('backup','Backup file',24),c('live','Live record / external link',30),c('status','Status',27),c('version','Version',13,'number'),c('current','Current',12),c('approved','This version approved',20),c('query','Query',55),c('actor','Uploaded by',27),c('date','Recorded (UTC)',24,'timestamp'),c('bytes','Bytes',16,'number'),id,c('parentId','Parent record ID',38),c('saleId','Sale ID',38),c('relatedSnags','Included snag IDs',45),c('storage','Original storage reference',55),c('sha256','Backup SHA-256',68)],model.references.map(r=>({...r,
    backup:link(r.relative,'Open backup file'),live:link(r.liveUrl || r.external,r.external?'External (not backed up)':'Open live record'),storage:r.bucket?`${r.bucket}/${r.key}`:''})),context);
  table(book,'Activity history',[...place,c('kind','Activity',27),c('date','When (UTC)',24,'timestamp'),c('actor','Person',28),c('description','Details',100),c('live','Live sale file',23),id,c('saleId','Sale ID',38)],model.history.map(r=>({...r,live:link(r.liveUrl)})),context);
  table(book,'Reports',[...place,c('location','Report location',30),c('date','Created (UTC)',24,'timestamp'),c('sent','Sent (UTC)',24,'timestamp'),c('count','Snags included',16,'number'),c('evidence','PDF',24),c('recipients','Recipients / delivery',65),c('snagIds','Included snag IDs',43),id],model.reports.map(r=>({...r,evidence:evidence(r.id)})),context);
  table(book,'Contacts',[c('kind','Role / organisation type',27),c('name','Name',32),c('person','Main contact',28),c('organisation','Organisation',32),c('email','Email',38),c('phone','Phone',23),c('buildings','Buildings',55),id],model.contacts,context);
  table(book,'Handover',[...place,c('date','Handover (UTC)',24,'timestamp'),c('recipient','Recipient',28),c('email','Recipient email',38),c('phone','Recipient phone',23),c('actor','Handed over by',28),c('keys','Number of keys',16,'number'),c('keyDetails','Key details',55),c('readings','Meter readings',65),c('evidence','Evidence',24),c('notes','Notes',60),id],model.handovers.map(r=>({...r,evidence:evidence(r.id)})),context);
  table(book,'Source counts',[c('table','Source table',47),c('count','Records in dump',22,'number')],Object.entries(model.counts).map(([table,count])=>({table,count})),context);
  await book.xlsx.writeFile(file);
  return book;
}

export async function writeWorkingLog(file,snapshot) {
  const book=new ExcelJS.Workbook();book.creator='Bunnywell Portal';
  const columns=[c('date','Action date (UTC)',24,'timestamp'),c('type','Record type',20),c('id','Sale / snag / unit ID',38),c('building','Building',27),c('unit','Unit',13),c('action','Action taken',65),c('status','New status / outcome',35),c('owner','Owner',28),c('due','Next deadline',20,'date'),c('next','Next action',55),c('evidence','Evidence filename / link',50),c('reconciled','Entered back in portal?',23)];
  const sheet=table(book,'Working log',columns,Array.from({length:25},()=>({})),`Copy outside the backup folder before editing. Starting snapshot: ${snapshot}`);
  for(let r=5;r<=29;r++){sheet.getCell(r,2).dataValidation={type:'list',allowBlank:true,formulae:['"Sale,Snag,Handover,Other"']};sheet.getCell(r,12).dataValidation={type:'list',allowBlank:true,formulae:['"No,Yes,Needs review"']};}
  await book.xlsx.writeFile(file);
}
