import {ReadingWindowSafety} from "./window-safety.mjs";
import { isImageName, validateModelImage } from "./image.mjs";
import { FIRST_OFFICE_WINDOW,validateOfficeWindow } from "./office-window.mjs";
import { coverageOnly } from "./material.mjs";
import { validatePdfVisualWindow } from "./pdf-visual.mjs";
import { PDF_WINDOW_PAGES } from "./pdf-window.mjs";
import {
  FIRST_ARCHIVE_WINDOW,
  validateArchiveWindow,
} from "./archive-window.mjs";

// Only trusted cursor/coverage metadata is durable. Text stays in the current
// execution window until its paid blocks are confirmed, then is discarded.
export class ReadingWindows {
  constructor(db,{engine}={}) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS reading_windows(task TEXT NOT NULL,attachment TEXT NOT NULL,
      content_hash TEXT NOT NULL,next_page INTEGER NOT NULL,next_offset INTEGER NOT NULL,coverage TEXT NOT NULL,
      PRIMARY KEY(task,attachment));`);
    if(engine)this.safety=new ReadingWindowSafety(engine);
  }
  rows(task) {
    return this.db
      .prepare("SELECT * FROM reading_windows WHERE task=? ORDER BY rowid")
      .all(task);
  }
  select(task, file, { archiveWindows = false, imageWindows = false, pdfVisualWindows = false, officeWindows = false } = {}) {
    const row = this.db
      .prepare("SELECT * FROM reading_windows WHERE task=? AND attachment=?")
      .get(task, file.id);
    this.safety?.select(task,file,row);
    if (row && row.content_hash !== file.hash) throw Error("INPUT_CHANGED");
    if (row?.next_page === 0) return { skip: true };
    if(isImageName(file.name)){
      if(!imageWindows)throw Error('READER_WINDOW_REQUIRED');
      return {skip:false,imageWindow:{tile:row?.next_page||1}};
    }
    const prior = row && JSON.parse(row.coverage);
    if(prior?.officePagination&&!officeWindows)throw Error("READER_WINDOW_REQUIRED");
    if(officeWindows&&/\.(docx|xlsx)$/i.test(file.name))return {skip:false,officeWindow:validateOfficeWindow(prior?.officePagination?.next||FIRST_OFFICE_WINDOW)};
    if(prior?.pdfVisualPagination && !pdfVisualWindows)throw Error("READER_WINDOW_REQUIRED");
    if(pdfVisualWindows && /\.pdf$/i.test(file.name))return {skip:false,pdfVisualWindow:validatePdfVisualWindow(prior?.pdfVisualPagination?.next || {page:1,tile:1,offset:0})};
    const saved = prior?.archivePagination;
    if (saved && (!archiveWindows || (saved.start?.visual && !pdfVisualWindows) || (saved.start?.office && !officeWindows))) throw Error("READER_WINDOW_REQUIRED");
    return {
      skip: false,
      ...(archiveWindows && /\.(zip|rar|7z)$/i.test(file.name)
        ? {
            archiveWindow: validateArchiveWindow(
              saved?.next || {...FIRST_ARCHIVE_WINDOW,...(pdfVisualWindows?{visual:1,tile:1}:{}),...(officeWindows?{office:1,image:0,text:1,tile:1}:{})},
            ),
          }
        : {}),
      ...(/\.pdf$/i.test(file.name)
        ? {
            pdfWindow: {
              page: row?.next_page || 1,
              offset: row?.next_offset || 0,
            },
          }
        : {}),
    };
  }
  verify(material, requested, archiveWindow, imageWindow, pdfVisualWindow, officeWindow) {
    if(officeWindow)return this.verifyOffice(material,officeWindow);
    if(pdfVisualWindow)return this.verifyPdfVisual(material,pdfVisualWindow);
    if(imageWindow){
      const p=material.imagePagination;
      if(!p){if(material.segments?.length)throw Error('INVALID_READER_WINDOW');return;}
      const r=material.covered?.[0];
      const columns=Math.ceil(p.width/1024),rows=Math.ceil(p.height/1024),frames=p.totalFrames??1,
        frameIndex=(p.startTile-1)%(columns*rows),x=(frameIndex%columns)*1024,y=Math.floor(frameIndex/columns)*1024;
      const image=material.segments?.[0]?.image;
      if(p.startTile!==imageWindow.tile||!Number.isSafeInteger(p.totalTiles)||p.totalTiles<1||p.totalTiles>64||
        p.startTile>p.totalTiles||p.nextTile!==(p.startTile<p.totalTiles?p.startTile+1:null)||
        material.covered?.length!==1||material.segments?.length!==1||r?.kind!=='image'||r.tile!==p.startTile||
        r.start!==p.startTile-1||r.end!==p.startTile||!image||
        !Number.isSafeInteger(p.width)||!Number.isSafeInteger(p.height)||p.width<1||p.height<1||p.width>16384||p.height>16384||p.width*p.height>32_000_000||
        !Number.isSafeInteger(frames)||frames<1||frames>64||p.width*p.height*frames>32_000_000||
        p.totalTiles!==columns*rows*frames||r.x!==x||r.y!==y||r.width!==Math.min(1024,p.width-x)||r.height!==Math.min(1024,p.height-y)||
        image.width!==r.width||image.height!==r.height||r.imageWidth!==p.width||r.imageHeight!==p.height||image.hash!==r.imageHash||r.sourceId!==material.segments[0].sourceId||
        JSON.stringify(material.segments[0].range)!==JSON.stringify(r))
        throw Error('INVALID_READER_WINDOW');
      validateModelImage(image);
      if (/\.(gif|webp)$/i.test(r.archivePath || material.name) && p.totalFrames === undefined)throw Error('INVALID_READER_WINDOW');
      if(p.totalFrames!==undefined || r.frame!==undefined){
        if(r.totalFrames!==frames || p.frame!==r.frame || r.frame!==Math.floor((p.startTile-1)/(columns*rows))+1 ||
          !Number.isSafeInteger(r.frameStartMs)||r.frameStartMs<0||r.frameStartMs!==p.frameStartMs||
          !Number.isSafeInteger(r.frameDurationMs)||r.frameDurationMs<0||r.frameDurationMs!==p.frameDurationMs)throw Error('INVALID_READER_WINDOW');
      }
      if (/\.jpe?g$/i.test(r.archivePath || material.name) && p.orientation === undefined)
        throw Error('INVALID_READER_WINDOW');
      if (p.orientation !== undefined || r.orientation !== undefined) {
        if (!Number.isSafeInteger(p.orientation) || p.orientation < 1 || p.orientation > 8 ||
            r.orientation !== p.orientation || r.encodedWidth !== p.encodedWidth || r.encodedHeight !== p.encodedHeight ||
            p.encodedWidth !== (p.orientation >= 5 ? p.height : p.width) ||
            p.encodedHeight !== (p.orientation >= 5 ? p.width : p.height))
          throw Error('INVALID_READER_WINDOW');
      }
      return;
    }
    if (archiveWindow) return this.verifyArchive(material, archiveWindow);
    if (!requested) return;
    const p = material.pagination;
    if (!p) {
      if (material.segments?.length) throw Error("INVALID_READER_WINDOW");
      return; // Whole-file failure is terminal, never an implicit first window.
    }
    if (
      p.startPage !== requested.page ||
      p.startOffset !== requested.offset ||
      !Number.isSafeInteger(p.totalPages) ||
      p.totalPages < p.startPage ||
      !Number.isSafeInteger(p.nextOffset) ||
      p.nextOffset < p.startOffset ||
      (p.nextPage === null &&
        p.startPage + PDF_WINDOW_PAGES - 1 < p.totalPages) ||
      (p.nextPage !== null &&
        (!Number.isSafeInteger(p.nextPage) ||
          p.nextPage < p.startPage ||
          p.nextPage > p.totalPages ||
          p.nextPage >
            Math.min(p.totalPages, p.startPage + PDF_WINDOW_PAGES - 1) + 1)) ||
      (material.covered || []).some(
        (r) =>
          r.kind !== "pdf" ||
          !Number.isSafeInteger(r.page) ||
          r.page < p.startPage ||
          r.page >= p.startPage + PDF_WINDOW_PAGES ||
          r.page > p.totalPages,
      )
    )
      throw Error("INVALID_READER_WINDOW");
    let offset = requested.offset,
      page = requested.page;
    for (const range of material.covered || []) {
      if (
        range.page < page ||
        range.start !== offset ||
        !Number.isSafeInteger(range.end) ||
        range.end <= offset ||
        (p.nextPage !== null && range.page >= p.nextPage)
      )
        throw Error("INVALID_READER_WINDOW");
      offset = range.end;
      page = range.page;
    }
    if (p.nextOffset !== offset) throw Error("INVALID_READER_WINDOW");
  }
  verifyArchive(material, requested) {
    const p = material.archivePagination;
    if (!p) {
      if (material.segments?.length) throw Error("INVALID_READER_WINDOW");
      return;
    }
    const invalid = () => {
      throw Error("INVALID_READER_WINDOW");
    };
    let start, next;
    try {
      start = validateArchiveWindow(p.start);
      next = p.next === null ? null : validateArchiveWindow(p.next);
    } catch {
      invalid();
    }
    if (
      !start ||
      JSON.stringify(start) !== JSON.stringify(requested) ||
      !Number.isSafeInteger(p.entries) ||
      p.entries <= requested.entry ||
      p.entries > 1000 ||
      typeof p.archivePath !== "string" ||
      (next &&
        (next.entry >= p.entries ||
          next.offset < start.offset ||
          next.expanded < start.expanded ||
          !(
            (next.entry === start.entry &&
              (next.page > start.page || (start.visual && next.page===start.page && next.tile===start.tile+1) || (start.office && (next.offset>start.offset || next.image>start.image || next.tile>start.tile || next.text<start.text))) &&
              next.base === start.base &&
              next.expanded === start.expanded) ||
            (next.entry === start.entry + 1 &&
              next.page === 1 &&
              next.base === next.offset)
          ))) ||
      (!next && start.entry !== p.entries - 1) ||
      (material.covered || []).some(
        (r) => r.archivePath !== p.archivePath || r.start < start.offset,
      )
    )
      invalid();
    if(p.pdfVisual){
      if(!start.visual || p.pdf || p.image)invalid();
      this.verifyPdfVisual(material,{page:start.page,tile:start.tile,offset:start.offset-start.base},{base:start.base,pagination:p.pdfVisual});
      const following=p.pdfVisual.next;
      if(!!following !== (next?.entry===start.entry) || (following && (next.page!==following.page || next.tile!==following.tile || next.offset!==start.base+following.offset)))invalid();
    } else if (p.image) {
      // page is the server-owned intra-member cursor: PDF page or PNG tile.
      // Image logical offsets count tiles, never characters or pixel bytes.
      if (p.pdf || start.page > 64 || start.offset !== start.base + start.page - 1)
        invalid();
      if (material.segments.length !== material.covered.length ||
          material.segments.some((s, i) => JSON.stringify(s.range) !== JSON.stringify(material.covered[i])))
        invalid();
      const covered = material.covered.map(r => ({
        ...r, start: r.start - start.base, end: r.end - start.base,
      }));
      this.verify({
        ...material, imagePagination: p.image, covered,
        segments: material.segments.map((s, i) => ({ ...s, range: covered[i] })),
      }, undefined, undefined, { tile: start.page });
      const more = p.image.nextTile > start.page;
      if (more !== (next?.entry === start.entry) ||
          (more && next.page !== p.image.nextTile) ||
          (next && next.offset !== start.base + p.image.startTile))
        invalid();
    } else if(p.office){
      this.verifyOffice(material,{text:start.text,image:start.image,tile:start.tile,offset:start.offset-start.base},{base:start.base,pagination:p.office});
      if(!!p.office.next!==(next?.entry===start.entry))invalid();
    } else if (p.pdf) {
      const relative = start.offset - start.base;
      this.verify(
        {
          pagination: p.pdf,
          segments: material.segments,
          covered: material.covered.map((r) => ({
            ...r,
            start: r.start - start.base,
            end: r.end - start.base,
          })),
        },
        { page: start.page, offset: relative },
      );
      const more = p.pdf.nextPage > start.page;
      if (
        more !== (next?.entry === start.entry) ||
        (more && next.page !== p.pdf.nextPage) ||
        (next && next.offset !== start.base + p.pdf.nextOffset)
      )
        invalid();
    } else if (next?.entry === start.entry) invalid();
    const ranges = [
      ...(material.covered || []),
      ...(material.uncovered || []).filter(
        (r) => r.archivePath === p.archivePath,
      ),
    ];
    const end = Math.max(
      start.offset,
      ...ranges.map((r) => (Number.isSafeInteger(r.end) ? r.end : 0)),
    );
    if (next && next.offset !== end) invalid();
  }
  verifyOffice(material,requested,{base=0,pagination=material.officePagination}={}) {
    const invalid=()=>{throw Error("INVALID_READER_WINDOW");};
    const p=pagination;
    if(!p){if(material.segments?.length)invalid();return;}
    if(JSON.stringify(validateOfficeWindow(p.start))!==JSON.stringify(validateOfficeWindow(requested)) ||
      !Number.isSafeInteger(p.totalText)||p.totalText<0||p.totalText>64*1024*1024||
      !Number.isSafeInteger(p.totalImages)||p.totalImages<0||p.totalImages>1000||material.segments.length!==material.covered.length)invalid();
    let offset=requested.offset,expected;
    for(let n=0;n<material.segments.length;n++){
      const segment=material.segments[n],r=segment.range;
      if(JSON.stringify(r)!==JSON.stringify(material.covered[n])||segment.sourceId!==r.sourceId||r.start!==offset+base)invalid();
      if(requested.text){
        if(segment.image||!["docx","xlsx"].includes(r.kind)||r.end!==r.start+[...segment.text].length||r.end>base+Math.min(p.totalText,requested.offset+120000))invalid();
      }else if(!segment.image||r.kind!=="image"||r.end!==r.start+1||typeof r.mediaPart!=="string"||typeof r.officeKind!=="string")invalid();
      offset=r.end-base;
    }
    if(requested.text){
      if(offset!==Math.min(p.totalText,requested.offset+120000))invalid();
      expected=offset<p.totalText?{...requested,offset}:p.totalImages?{text:0,image:0,tile:1,offset}:null;
    }else{
      if(requested.image>=p.totalImages)invalid();
      if(p.image){
        const covered=material.covered.map(r=>({...r,start:requested.tile-1,end:requested.tile}));
        this.verify({...material,name:material.covered[0]?.mediaPart,imagePagination:p.image,covered,segments:material.segments.map((s,n)=>({...s,range:covered[n]}))},undefined,undefined,{tile:requested.tile});
      }else if(!p.failedImage||material.segments.length)invalid();
      expected=p.image?.nextTile?{...requested,tile:p.image.nextTile,offset}:requested.image+1<p.totalImages?{text:0,image:requested.image+1,tile:1,offset}:null;
    }
    if(p.nextOffset!==offset || JSON.stringify(p.next)!==JSON.stringify(expected))invalid();
  }
  verifyPdfVisual(material, requested, {base=0,pagination=material.pdfVisualPagination}={}) {
    const invalid=()=>{throw Error("INVALID_READER_WINDOW");};
    const p=pagination;
    if(!p){if(material.segments?.length)invalid();return;}
    if(p.failedPage!==undefined && p.failedPage!==true)invalid();
    if(p.page!==requested.page || p.startTile!==requested.tile || p.startOffset!==requested.offset ||
      !Number.isSafeInteger(p.totalPages)||p.totalPages<p.page || p.totalPages>2147483647 ||
      !Number.isSafeInteger(p.nextOffset)||p.nextOffset<p.startOffset)invalid();
    let offset=requested.offset+base;
    if(material.segments.length!==material.covered.length)invalid();
    for(let n=0;n<material.segments.length;n++){
      const segment=material.segments[n],r=segment.range;
      if(JSON.stringify(r)!==JSON.stringify(material.covered[n]) || segment.sourceId!==r.sourceId ||
        r.page!==requested.page || r.start!==offset || ![0,90,180,270].includes(r.rotation))invalid();
      if(segment.image){
        validateModelImage(segment.image);
        if(p.failedPage || r.kind!=="image" || r.end!==r.start+1 || r.tile!==requested.tile || r.dpi!==108 ||
          r.totalTiles!==p.totalTiles || r.imageWidth!==p.width || r.imageHeight!==p.height ||
          r.width!==segment.image.width || r.height!==segment.image.height || r.imageHash!==segment.image.hash)invalid();
      }else if(requested.tile!==1 || r.kind!=="pdf" || r.end!==r.start+[...segment.text].length)invalid();
      offset=r.end;
    }
    if(offset!==p.nextOffset+base)invalid();
    let expected;
    if(p.failedPage){
      if(p.totalTiles!==requested.tile || material.segments.some(s=>s.image) || !material.uncovered.some(r=>r.code!=="PDF_VISUAL_WINDOW_PENDING"))invalid();
      expected=p.page<p.totalPages?{page:p.page+1,tile:1,offset:p.nextOffset}:null;
    }else{
      const columns=Math.ceil(p.width/1024),rows=Math.ceil(p.height/1024),image=material.segments.filter(s=>s.image);
      if(!Number.isSafeInteger(p.width)||!Number.isSafeInteger(p.height)||p.width<1||p.height<1||p.width>16384||p.height>16384||p.width*p.height>32_000_000||
        p.totalTiles!==columns*rows || p.totalTiles>64 || requested.tile>p.totalTiles || image.length!==1)invalid();
      const r=image[0].range,x=((p.startTile-1)%columns)*1024,y=Math.floor((p.startTile-1)/columns)*1024;
      if(r.x!==x||r.y!==y||r.width!==Math.min(1024,p.width-x)||r.height!==Math.min(1024,p.height-y))invalid();
      expected=p.startTile<p.totalTiles?{page:p.page,tile:p.startTile+1,offset:p.nextOffset}:p.page<p.totalPages?{page:p.page+1,tile:1,offset:p.nextOffset}:null;
    }
    if(JSON.stringify(p.next)!==JSON.stringify(expected))invalid();
  }
  merge(previous, material) {
    const next = coverageOnly(material);
    if (!previous) return next;
    if (previous.contentHash !== next.contentHash) throw Error("INPUT_CHANGED");
    const uncovered = [...new Map([
      ...previous.uncovered.filter(
        (r) =>
          !["PDF_WINDOW_PENDING", "PDF_VISUAL_WINDOW_PENDING", "ARCHIVE_WINDOW_PENDING", "IMAGE_WINDOW_PENDING", "OFFICE_WINDOW_PENDING"].includes(r.code),
      ),
      ...next.uncovered,
    ].map(r=>[JSON.stringify(r),r])).values()];
    const covered = [...previous.covered, ...next.covered];
    const archiveImageTiles = [...new Map([
      ...(previous.archiveImageTiles || []), ...(next.archiveImageTiles || []),
    ].map(p => [p.archivePath, p])).values()];
    return {
      ...next,
      ...((previous.officeImageParts||next.officeImageParts)?{officeImageParts:[...new Map([...(previous.officeImageParts||[]),...(next.officeImageParts||[])].map(r=>[(r.archivePath||"")+":"+r.image,r])).values()]}:{}),
      ...(archiveImageTiles.length ? { archiveImageTiles } : {}),
      ...(previous.archivePdfPages || next.archivePdfPages
        ? {
            archivePdfPages: [
              ...new Map(
                [
                  ...(previous.archivePdfPages || []),
                  ...(next.archivePdfPages || []),
                ].map((p) => [p.archivePath, p]),
              ).values(),
            ],
          }
        : {}),
      ...((previous.archivePdfVisualPages||next.archivePdfVisualPages) ? {archivePdfVisualPages:[...new Map([...(previous.archivePdfVisualPages||[]),...(next.archivePdfVisualPages||[])].map(p=>[p.archivePath,p])).values()]} : {}),
      covered,
      uncovered,
      reasons: [
        ...new Set([
          ...previous.reasons.filter(
            (c) =>
              !["PDF_WINDOW_PENDING", "PDF_VISUAL_WINDOW_PENDING", "ARCHIVE_WINDOW_PENDING", "IMAGE_WINDOW_PENDING", "OFFICE_WINDOW_PENDING"].includes(c),
          ),
          ...next.reasons,
        ]),
      ],
      state: uncovered.length
        ? covered.length
          ? "partial"
          : [...previous.reasons, ...next.reasons].some((c) =>
                /UNSUPPORTED/.test(c),
              )
            ? "unsupported"
            : "failed"
        : next.state,
    };
  }
  coverage(task, materials) {
    const map = new Map(
      this.rows(task).map((r) => [r.attachment, JSON.parse(r.coverage)]),
    );
    for (const material of materials)
      map.set(
        material.attachmentId,
        this.merge(map.get(material.attachmentId), material),
      );
    return [...map.values()];
  }
  advance(task, materials) {
    const previous = new Map(
      this.rows(task).map((r) => [r.attachment, JSON.parse(r.coverage)]),
    );
    const save = this.db.prepare(
      "INSERT OR REPLACE INTO reading_windows VALUES(?,?,?,?,?,?)",
    );
    for (const material of materials) {
      const p = material.pagination;
      const next = material.officePagination ? material.officePagination.next?1:0 : material.pdfVisualPagination ? material.pdfVisualPagination.next?.page || 0 : material.imagePagination ? material.imagePagination.nextTile || 0 : material.archivePagination
        ? material.archivePagination.next
          ? 1
          : 0
        : p?.nextPage && p.nextPage > p.startPage
          ? p.nextPage
          : 0;
      const coverage = this.merge(
        previous.get(material.attachmentId),
        material,
      );
      this.safety?.stage(task,{task,attachment:material.attachmentId,content_hash:material.contentHash,next_page:next,next_offset:p?.nextOffset||0,coverage:JSON.stringify(coverage)});
      save.run(
        task,
        material.attachmentId,
        material.contentHash,
        next,
        p?.nextOffset || 0,
        JSON.stringify(coverage),
      );
    }
    return this.rows(task).some((r) => r.next_page > 0);
  }
  purge(task) {
    this.safety?.purge(task);
    this.db.prepare("DELETE FROM reading_windows WHERE task=?").run(task);
  }
  pending(task, files, options) {
    return files.some((f) => !this.select(task, f, options).skip);
  }
}
