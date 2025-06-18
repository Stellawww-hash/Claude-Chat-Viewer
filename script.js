/* ============ 全局状态 ============ */
let conversations = [];   // 原始数组（会被就地修改）
let activeIdx = null;     // 当前会话索引
let messages = [];        // 当前会话展开的 message 引用（与 conversations 内对象同源）
let contextMenu = null;   // 右键菜单引用
let searchTerm = '';      // 当前搜索词
let searchHighlights = [];// 搜索高亮位置
let currentSearchIndex = -1; // 当前搜索结果索引
let totalSearchResults = 0; // 总搜索结果数
let searchQueue = [];                // 待异步扫描的对话队列
let convHoverTooltip = null;         // 悬浮会话 tooltip 实例
let currentCard = null;
let selectToggleBtn = null;   // 全选/全不选按钮
let selectModeBtn = null;     // 选择模式切换按钮
let isSelectMode = false;     // 是否处于选择模式

/* ============ DOM refs ============ */
const fileInput  = document.getElementById('file-input');
const convList   = document.getElementById('conv-list');
const chatPanel  = document.getElementById('chat');
const exportArea = document.getElementById('export-area');
const exportAll  = document.getElementById('export-all');
const exportOne  = document.getElementById('export-one');
const sidebar    = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const mobileOverlay = document.getElementById('mobile-overlay');
const floatingSidebarBtn = document.getElementById('floating-sidebar-btn');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchNavigation = document.getElementById('search-navigation');
const searchCounter = document.getElementById('search-counter');
const searchPrev = document.getElementById('search-prev');
const searchNext = document.getElementById('search-next');
const searchIndexInput = document.getElementById('search-index-input');
const searchTotal = document.getElementById('search-total');

/* ============ 工具函数 ============ */
const fmt = t => t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '';
const $ = id => document.getElementById(id);

// ============ 全局文本占位符替换 ============
const TEXT_REPLACEMENTS = {
  'This block is not supported on your current device yet.': 'web search',
  'Analysis Tool outputs from the web feature preview aren’t yet supported on mobile.': 'Analysis Tool',
  'Viewing artifacts created via the Analysis Tool web feature preview isn’t yet supported on mobile.': 'artifacts'
};

function applyReplacements(text = '') {
  let t = text;
  for (const [orig, rep] of Object.entries(TEXT_REPLACEMENTS)) {
    // 全局 + 不区分大小写匹配；对 orig 做转义，同时允许 smart/straight apostrophe 已覆盖
    const regex = new RegExp(orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    t = t.replace(regex, rep);
  }
  return t;
}

/* 把各种字段统一转成时间戳（毫秒） */
const toMillis = m => {
  const raw = m.timestamp || m.created_at ||
              m.content?.[0]?.start_timestamp || m.time || '';
  return raw ? +new Date(raw) : 0;
};

/* 计算会话第一条有效消息的时间（毫秒） */
const firstMillis = conv => {
  const msgs = conv.chat_messages || [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (['human', 'assistant'].includes(m.sender) && m.text?.trim()) {
      return toMillis(m);
    }
  }
  return 0;
};

/* 计算会话最后一条有效消息的时间（毫秒） */
const lastMillis = conv => {
  const msgs = conv.chat_messages || [];
  // 从后往前找第一条 human / assistant 且有文本的消息
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (['human', 'assistant'].includes(m.sender) && m.text?.trim()) {
      return toMillis(m);
    }
  }
  return 0;           // 没找到就返回 0，排在最末
};

/* 搜索按钮点击事件 */
searchBtn.addEventListener('click', () => {
  performSearch(searchInput.value);
});

/* 搜索输入框回车事件 */
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    performSearch(searchInput.value);
  }
});

/* 搜索输入框内容变化事件，确保清空时立即响应 */
searchInput.addEventListener('input', (e) => {
  if (e.target.value.trim() === '') {
    performSearch('');
  }
});

/* 初始化搜索索引输入框 */
function initSearchIndexInput() {
  const searchIndexInput = document.getElementById('search-index-input');
  
  if (!searchIndexInput) return;
  
  // 输入验证：只允许数字，且在有效范围内
  searchIndexInput.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    const max = totalSearchResults;
    
    if (isNaN(value) || value < 1) {
      e.target.value = Math.max(1, currentSearchIndex + 1);
      return;
    }
    
    if (value > max && max > 0) {
      e.target.value = max;
      return;
    }
    
    // 如果输入有效，跳转到对应结果
    if (value >= 1 && value <= max) {
      currentSearchIndex = value - 1;
      updateSearchResults();
      scrollToSearchResult();
    }
  });
  
  // 回车键确认
  searchIndexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  });
  
  // 失焦时确保值有效
  searchIndexInput.addEventListener('blur', (e) => {
    const value = parseInt(e.target.value);
    const max = totalSearchResults;
    
    if (isNaN(value) || value < 1 || value > max) {
      e.target.value = Math.max(1, currentSearchIndex + 1);
    }
  });
}

/* ESC 清空搜索 */
document.addEventListener('keydown', (e) => {
  // ESC 清空搜索
  if (e.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    performSearch('');
    searchInput.blur();
  }
});

/* 移动端侧边栏切换 */
function toggleSidebar() {
  const isCollapsed = sidebar.classList.contains('collapsed');
  
  if (isCollapsed) {
    // 展开侧边栏
    sidebar.classList.remove('collapsed');
    if (window.innerWidth <= 768) {
      mobileOverlay.style.display = 'block';
    }
    if (sidebarToggle) {
      sidebarToggle.textContent = '☰ 隐藏会话列表';
    }
  } else {
    // 收起侧边栏
    sidebar.classList.add('collapsed');
    mobileOverlay.style.display = 'none';
    if (sidebarToggle) {
      sidebarToggle.textContent = '☰ 显示会话列表';
    }
  }
}

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', toggleSidebar);
}

/* 浮动按钮控制侧边栏 */
if (floatingSidebarBtn) {
  floatingSidebarBtn.addEventListener('click', toggleSidebar);
}

/* 点击遮罩层不关闭侧边栏，只有悬浮按钮才能关闭 */
if (mobileOverlay) {
  mobileOverlay.addEventListener('click', () => {
    // 移除自动关闭功能
  });
}

/* 文件拖拽悬停阻止默认行为 */
document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

/* 渲染左侧会话列表 - 添加搜索过滤 */
function renderConvList(){
  convList.innerHTML='';
  
  // 过滤符合搜索条件的对话框
  const filteredConversations = conversations.filter(conversationMatchesSearch);
  
  filteredConversations.forEach((c,i)=>{
    // 找到原始索引
    const originalIdx = conversations.findIndex(conv => conv === c);
    
    const row = document.createElement('div');
    row.className = 'conv-item';

    const sel = document.createElement('input');
    sel.type = 'checkbox';
    sel.className = 'conv-sel';
    sel.checked = !!c._selected;
    sel.style.display = isSelectMode ? 'block' : 'none';
    sel.onchange = ()=>{ c._selected = sel.checked; updateExportButtons(); updateSelectToggleState(); };

    const b=document.createElement('button');
    b.className='conv-btn'+(originalIdx===activeIdx?' active':'');
    
    // 高亮搜索结果
    b.innerHTML = highlightSearchText(c.name);
    
    b.onclick=()=>selectConv(originalIdx);

    /* ---------- 时间显示功能 ---------- */
    if (window.innerWidth > 768) {
      // 桌面端：悬停显示时间 Tooltip
      b.addEventListener('mouseenter', ()=>{
        showConvTooltip(b,c);
      });
      b.addEventListener('mouseleave', hideConvTooltip);
      b.addEventListener('mousemove', (e)=>{
        if(convHoverTooltip){
          convHoverTooltip.style.top = (e.clientY + 12) + 'px';
          convHoverTooltip.style.left = (e.clientX + 12) + 'px';
        }
      });
    } else {
      // 移动端：长按显示时间信息
      let longPressTimer = null;
      let isLongPress = false;
      
      b.addEventListener('touchstart', (e) => {
        isLongPress = false;
        longPressTimer = setTimeout(() => {
          isLongPress = true;
          e.preventDefault();
          showConvTimeInfo(b, c);
        }, 800); // 800ms长按触发
      });
      
      b.addEventListener('touchend', (e) => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        if (isLongPress) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
      
      b.addEventListener('touchmove', (e) => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
    }
    
    row.appendChild(sel);
    row.appendChild(b);
    convList.appendChild(row);
  });

  updateSelectToggleState();

  if(activeIdx===null){
    chatPanel.innerHTML=`
      <div style="text-align:center;font-size:16px;color:#64748b">
        <div style="font-size:48px;margin-bottom:16px">💬</div>
        <div>请选择会话开始查看</div>
      </div>
    `;
    chatPanel.style.justifyContent='center';
    exportArea.style.display='none';
  }
  
  // 更新导出按钮状态
  if (conversations.length > 0) {
    updateExportButtons();
  }
}

/* 选中会话 */
function selectConv(i){
  activeIdx = i;
  const raw = conversations[i].chat_messages || [];

  /* -------- 时间排序：先过滤再排序 -------- */
  messages = raw
    .filter(m => ['human','assistant'].includes(m.sender) && m.text?.trim())
    .sort((a, b) => toMillis(a) - toMillis(b))   // ⬅️ 关键：按毫秒值升序
    .map(m => { m._images ??= []; extractToolData(m); return m; });

  /* 同步引用，保证导出 JSON 也按新顺序 */
  conversations[i].chat_messages = messages;

  // 清除之前的选择状态并退出选择模式
  exitSelectionMode();

  renderConvList();
  renderChat();
  exportArea.style.display = 'flex';
  
  // 重置搜索索引并更新搜索结果
  currentSearchIndex = -1;
  updateSearchResults();
}

/* 重新渲染聊天区 - 添加搜索高亮 */
function renderChat(){
  chatPanel.innerHTML='';
  chatPanel.style.justifyContent='flex-start';

  // 显示所有消息，保持原始顺序
  messages.forEach((m,originalIdx)=>{
    
    const wrap=document.createElement('div');
    wrap.className=`msg ${m.sender==='human'?'user':'assistant'}`;

    /* ---------- 双击显示多选选项 ---------- */
    wrap.addEventListener('dblclick', (e) => {
      e.preventDefault();
      showMultiSelectOption(e, wrap, m, originalIdx);
    });
    
    /* ---------- 选择状态下的单击选择 ---------- */
    wrap.addEventListener('click', (e) => {
      if (isInSelectionMode) {
        e.preventDefault();
        toggleBubbleSelection(wrap, m, originalIdx);
      }
    });

    /* ---------- 行首时间戳 ---------- */
    const ts=document.createElement('div');
    ts.className='timestamp'; 
    ts.textContent=fmt(m.timestamp||m.created_at||m.content?.[0]?.start_timestamp);
    wrap.appendChild(ts);
    
    /* ---------- 彩泡 / Markdown 带搜索高亮 ---------- */
    const bubble=document.createElement('div');
    bubble.className='bubble';
    const replacedText = applyReplacements(m.text || '');
    const highlightedText = highlightSearchText(replacedText);
    bubble.innerHTML = marked.parse(highlightedText);
    bubble._message = m;  // 传递消息对象
    
    // 增强代码块功能
    enhanceCodeBlocks(bubble);
    
    wrap.appendChild(bubble);

    /* ---------- 已插入图片 ---------- */
    m._images.forEach((src,pi)=>{
      const holder=document.createElement('div');
      holder.className='img-wrap';
      const img=document.createElement('img');
      img.src=src; img.className='upload';
      
      // 添加点击展开功能
      img.onclick = (e) => {
        e.stopPropagation();
        showImageModal(src);
      };
      
      const del=document.createElement('button');
      del.textContent='✖️';
      del.onclick=(e)=>{
        e.stopPropagation();
        m._images.splice(pi,1);
        renderChat();
      };
      holder.appendChild(img);
      holder.appendChild(del);
      wrap.appendChild(holder);
    });

    /* ---------- 浮动操作按钮 ---------- */
    const actions=document.createElement('div');
    actions.className='actions';
    actions.innerHTML='<button class="icon-btn cam" title="插入图片">📷</button>';
    wrap.appendChild(actions);

    // 插图菜单
    actions.querySelector('.cam').onclick=()=>{
      const menu=document.createElement('div');
      menu.className='menu-popup';
      menu.style.top='28px'; 
      menu.style.right='0';
      menu.innerHTML='<button>📁 本地上传</button><button>🔗 链接插入</button>';
      actions.appendChild(menu);

      // 本地
      menu.children[0].onclick=()=>{
        const inp=document.createElement('input');
        inp.type='file'; inp.accept='image/*';
        inp.onchange=e=>{
          const f=e.target.files[0]; if(!f) return;
          const fr=new FileReader();
          fr.onload=ev=>{ m._images.push(ev.target.result); renderChat(); };
          fr.readAsDataURL(f);
        };
        inp.click();
        actions.removeChild(menu);
      };
      
      // 链接
      menu.children[1].onclick=()=>{
        const url=prompt('请输入图片 URL：');
        if(url && url.trim()) { m._images.push(url.trim()); renderChat(); }
        actions.removeChild(menu);
      };
      
      // 点击外部关闭
      document.addEventListener('click', function h(ev){
        if(!menu.contains(ev.target) && !actions.contains(ev.target)){ 
          if(actions.contains(menu)) actions.removeChild(menu); 
          document.removeEventListener('click',h); 
        }
      }, {capture:true});
    };

    chatPanel.appendChild(wrap);
  });
  
  // 更新导出按钮状态（因为可能添加或删除了本地图片）
  updateExportButtons();

  if(messages.length===0){
    chatPanel.innerHTML=`
      <div style="text-align:center;font-size:16px;color:#64748b">
        <div style="font-size:48px;margin-bottom:16px">📭</div>
        <div>此会话暂无可显示消息</div>
      </div>
    `;
    chatPanel.style.justifyContent='center';
  }
}

/* ============ 导出 JSON ============ */
function downloadJSON(obj,filename){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  URL.revokeObjectURL(a.href);
}

/* 检查是否包含本地上传的图片（base64） */
function hasLocalImages(conversations) {
  return conversations.some(conv => {
    const messages = conv.chat_messages || [];
    return messages.some(msg => {
      const images = msg._images || [];
      return images.some(src => src.startsWith('data:'));
    });
  });
}

/* 更新导出按钮状态 */
function updateExportButtons() {
  const selected = conversations.filter(c=>c._selected);
  const hasLocal = hasLocalImages(selected);

  if(!isSelectMode || selected.length===0){
    exportAll.disabled = true;
    exportAll.textContent = '⬇️ 导出选中 JSON';
    exportAll.style.background = 'linear-gradient(135deg, #94a3b8, #64748b)';
    exportAll.style.cursor = 'not-allowed';
  }else if(hasLocal){
    exportAll.disabled = true;
    exportAll.textContent = '🚫 选中会话包含本地图片';
    exportAll.style.background = 'linear-gradient(135deg, #94a3b8, #64748b)';
    exportAll.style.cursor = 'not-allowed';
  } else {
    exportAll.disabled = false;
    exportAll.textContent = `⬇️ 导出选中 ${selected.length} 个 JSON`;
    exportAll.style.background = 'linear-gradient(135deg, #059669, #047857)';
    exportAll.style.cursor = 'pointer';
    exportAll.title = '';
  }
}

/* 导出整包 */
exportAll.onclick=()=>{
  if (exportAll.disabled) return;
  const selected = conversations.filter(c=>c._selected);
  if(selected.length===0) return;
  downloadJSON(selected,'claude_export_selected.json');
};

/* 导出当前会话 */
exportOne.onclick=()=>{
  if(activeIdx===null) return;
  downloadJSON(conversations[activeIdx], (conversations[activeIdx].name||'conversation')+'.json');
};

/* 文件拖拽支持（改为流式解析） */
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].type === 'application/json') {
    loadJsonStreaming(files[0]);
  }
});

/* ============ 文件导入（流式解析） ============ */
/**
 * 使用浏览器 ReadableStream + oboe.js 对大型 JSON 文件进行流式解析，
 * 只要解析到会话根对象（含 name/uuid 等信息）就立即插入列表，
 * 避免一次性 JSON.parse 带来的主线程阻塞。
 */
function loadJsonStreaming(file) {
  // 清空旧数据与界面
  conversations = [];
  activeIdx = null;
  // 重置选择模式
  isSelectMode = false;
  if(selectModeBtn) selectModeBtn.textContent = '☑️ 选择';
  if(selectToggleBtn) selectToggleBtn.style.display = 'none';
  renderConvList();

  // 提示信息
  convList.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b">⏳ 正在解析文件，请稍候...</div>';

  // oboe 实例
  const parser = oboe();

  // 每解析到一个会话对象就推入数组并刷新列表（保持最新排序）
  parser.node('![*]', (conv) => {
    if (conv && conv.name && conv.name.trim()) {
      conversations.push(conv);
      conversations.sort((a, b) => lastMillis(b) - lastMillis(a));
      renderConvList();
    }
  });

  // 解析完毕回调；用于处理根即单个对话对象的情况
  parser.done((root) => {
    if (conversations.length === 0) {
      // root 可能是单对象或对象数组
      const arr = Array.isArray(root) ? root : [root];
      arr.forEach(conv => {
        if (conv && conv.name && conv.name.trim()) {
          conversations.push(conv);
        }
      });
      conversations.sort((a, b) => lastMillis(b) - lastMillis(a));
    }

    // 若解析完成仍无数据，则显示提示
    if (conversations.length === 0) {
      convList.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b">⚠️ 未检测到有效会话</div>';
    } else {
      renderConvList();
    }
  });

  parser.fail((err) => {
    alert('解析失败: ' + (err.thrown || err));
  });

  // 读取文件流并喂给 oboe
  const decoder = new TextDecoder('utf-8');
  let reader;

  // 优先使用原生 stream，低版本浏览器回退到 FileReader
  if (file.stream && typeof file.stream === 'function') {
    reader = file.stream().getReader();
  } else {
    // 回退：一次性读取，但依旧避免 JSON.parse（只是渲染进度无法实时更新）
    const fr = new FileReader();
    fr.onload = (e) => {
      parser.emit('data', e.target.result);
      parser.emit('done');
    };
    fr.readAsText(file, 'utf-8');
    return;
  }

  function pump() {
    reader.read().then(({ done, value }) => {
      if (done) {
        parser.emit('done');
        return;
      }
      parser.emit('data', decoder.decode(value, { stream: true }));
      // 继续读取下一块
      pump();
    });
  }

  pump();
}

/* 页面加载完成后初始化 */
document.addEventListener('DOMContentLoaded', () => {
  initMobileState();
  updateMobileFrosted();
  
  // 初始化搜索索引输入框事件
  initSearchIndexInput();

  // 动态插入按钮
  if (!selectModeBtn) {
    // 创建按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container';
    
    // 创建选择模式按钮
    selectModeBtn = document.createElement('button');
    selectModeBtn.id = 'select-mode-btn';
    selectModeBtn.className = 'export-btn select-mode-btn';
    selectModeBtn.onclick = toggleSelectMode;
    selectModeBtn.textContent = '☑️ 选择';
    
    // 创建全选按钮
    selectToggleBtn = document.createElement('button');
    selectToggleBtn.id = 'select-toggle';
    selectToggleBtn.className = 'export-btn select-toggle-btn';
    selectToggleBtn.onclick = toggleSelectAll;
    selectToggleBtn.textContent = '✅ 全选会话';
    selectToggleBtn.style.display = 'none'; // 默认隐藏
    
    buttonContainer.appendChild(selectModeBtn);
    buttonContainer.appendChild(selectToggleBtn);
    
    // 将按钮容器插入到 export-area 最前面
    const ea = document.getElementById('export-area');
    if (ea) ea.insertBefore(buttonContainer, ea.firstChild);
  }
});

/* 窗口大小变化时重新初始化 */
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    // 桌面端：移除collapsed类，隐藏遮罩
    sidebar.classList.remove('collapsed');
    mobileOverlay.style.display = 'none';
    // 桌面端更新按钮文本
    if (sidebarToggle) {
      sidebarToggle.textContent = '☰ 隐藏会话列表';
    }
    // 关闭移动端时间信息框
    hideConvTimeInfo();
  } else {
    // 移动端：只初始化按钮文本，不强制收起侧边栏
    if (sidebarToggle) {
      const isCollapsed = sidebar.classList.contains('collapsed');
      sidebarToggle.textContent = isCollapsed ? '☰ 显示会话列表' : '☰ 隐藏会话列表';
    }
    // 关闭桌面端悬浮提示
    hideConvTooltip();
  }
  
  // 更新毛玻璃效果
  updateMobileFrosted();
  
  // 重新渲染会话列表以应用正确的事件处理器
  renderConvList();
});

/* ============ 气泡选择系统 ============ */
let selectedBubbles = new Set(); // 存储选中的气泡索引
let isInSelectionMode = false;   // 是否处于选择模式
let multiSelectMenu = null;      // 多选菜单引用

function toggleBubbleSelection(bubbleElement, message, messageIndex) {
  const isSelected = selectedBubbles.has(messageIndex);
  
  if (isSelected) {
    selectedBubbles.delete(messageIndex);
    bubbleElement.classList.remove('selected-bubble');
  } else {
    selectedBubbles.add(messageIndex);
    bubbleElement.classList.add('selected-bubble');
  }
  
  updateSelectionToolbar();
}

function showMultiSelectOption(e, bubbleElement, message, messageIndex) {
  // 关闭之前的菜单
  closeMultiSelectMenu();
  
  multiSelectMenu = document.createElement('div');
  multiSelectMenu.className = 'multi-select-menu';
  multiSelectMenu.innerHTML = `
    <button class="multi-select-btn" onclick="enterSelectionMode(${messageIndex})">
      ☑️ 多选
    </button>
  `;
  
  document.body.appendChild(multiSelectMenu);
  
  // 定位菜单
  const rect = multiSelectMenu.getBoundingClientRect();
  const x = Math.min(e.clientX, window.innerWidth - rect.width - 10);
  const y = Math.min(e.clientY, window.innerHeight - rect.height - 10);
  
  multiSelectMenu.style.left = x + 'px';
  multiSelectMenu.style.top = y + 'px';
  
  // 点击外部关闭
  setTimeout(() => {
    document.addEventListener('click', closeMultiSelectMenuOnOutsideClick);
  }, 0);
}

function closeMultiSelectMenu() {
  if (multiSelectMenu) {
    multiSelectMenu.remove();
    multiSelectMenu = null;
    document.removeEventListener('click', closeMultiSelectMenuOnOutsideClick);
  }
}

function closeMultiSelectMenuOnOutsideClick(e) {
  if (multiSelectMenu && !multiSelectMenu.contains(e.target)) {
    closeMultiSelectMenu();
  }
}

function enterSelectionMode(firstBubbleIndex = null) {
  isInSelectionMode = true;
  closeMultiSelectMenu();
  
  // 如果指定了第一个气泡，自动选中它
  if (firstBubbleIndex !== null) {
    const bubbleElement = document.querySelectorAll('.msg')[firstBubbleIndex];
    if (bubbleElement) {
      selectedBubbles.add(firstBubbleIndex);
      bubbleElement.classList.add('selected-bubble');
    }
  }
  
  // 显示选择状态指示
  document.body.classList.add('selection-mode');
  updateSelectionToolbar();
  showCopyToast('进入多选模式，单击气泡进行选择');
}

function exitSelectionMode() {
  isInSelectionMode = false;
  document.body.classList.remove('selection-mode');
  clearAllSelections();
}

function clearAllSelections() {
  selectedBubbles.clear();
  document.querySelectorAll('.selected-bubble').forEach(el => {
    el.classList.remove('selected-bubble');
  });
  updateSelectionToolbar();
}

function updateSelectionToolbar() {
  const toolbar = document.getElementById('selection-toolbar');
  const count = selectedBubbles.size;
  
  if (isInSelectionMode) {
    if (!toolbar) {
      createSelectionToolbar();
    } else {
      toolbar.style.display = 'flex';
      toolbar.querySelector('.selection-count').textContent = `多选模式 - 已选择 ${count} 条消息`;
    }
  } else {
    if (toolbar) {
      toolbar.style.display = 'none';
    }
  }
}

/* 显示图片模态框 */
function showImageModal(src) {
  const modal = document.createElement('div');
  modal.className = 'img-modal';
  
  const img = document.createElement('img');
  img.src = src;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => {
    document.body.removeChild(modal);
  };
  
  modal.appendChild(img);
  modal.appendChild(closeBtn);
  
  // 点击模态框背景关闭
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  };
  
  // ESC键关闭
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      document.body.removeChild(modal);
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
  
  document.body.appendChild(modal);
}

/* 初始化移动端状态 */
function initMobileState() {
  if (window.innerWidth <= 768) {
    sidebar.classList.add('collapsed');
    mobileOverlay.style.display = 'none';
    // 移动端默认启用毛玻璃效果
    document.body.classList.add('mobile-frosted');
    if (sidebarToggle) {
      sidebarToggle.textContent = '☰ 显示会话列表';
    }
  }
}

function createSelectionToolbar() {
  const toolbar = document.createElement('div');
  toolbar.id = 'selection-toolbar';
  toolbar.className = 'selection-toolbar';
  toolbar.innerHTML = `
    <div class="toolbar-content">
      <span class="selection-count">多选模式 - 已选择 ${selectedBubbles.size} 条消息</span>
      <div class="toolbar-actions">
        <button class="toolbar-btn" onclick="copySelectedToClipboard()" title="复制到剪贴板">
          📋 复制
        </button>
        <button class="toolbar-btn" onclick="exportSelectedAsMarkdown()" title="导出为Markdown">
          📄 导出MD
        </button>
        <button class="toolbar-btn delete-btn" onclick="deleteSelectedBubbles()" title="删除选中的消息">
          🗑️删除
        </button>
        <button class="toolbar-btn exit-btn" onclick="exitSelectionMode()" title="退出多选模式">
          ↩️ 退出
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(toolbar);
}

function copySelectedToClipboard() {
  const selectedMessages = Array.from(selectedBubbles)
    .sort((a, b) => a - b)
    .map(index => {
      const msg = messages[index];
      const sender = msg.sender === 'human' ? 'User' : 'Assistant';
      const time = fmt(msg.timestamp || msg.created_at || msg.content?.[0]?.start_timestamp);
      return `[${time}] ${sender}: ${applyReplacements(msg.text || '')}`;
    }).join('\n\n');
  
  navigator.clipboard.writeText(selectedMessages).then(() => {
    showCopyToast('已复制到剪贴板');
  }).catch(err => {
    console.error('复制失败:', err);
    showCopyToast('复制失败');
  });
}

function exportSelectedAsMarkdown() {
  const selectedMessages = Array.from(selectedBubbles)
    .sort((a, b) => a - b)
    .map(index => {
      const msg = messages[index];
      const sender = msg.sender === 'human' ? 'User' : 'Assistant';
      const time = fmt(msg.timestamp || msg.created_at || msg.content?.[0]?.start_timestamp);
      return `## ${sender}\n**时间**: ${time}\n\n${applyReplacements(msg.text || '')}\n`;
    }).join('\n---\n\n');
  
  const blob = new Blob([selectedMessages], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `selected_messages_${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showCopyToast('Markdown文件已下载');
}

function deleteSelectedBubbles() {
  if (selectedBubbles.size === 0) return;
  
  if (confirm(`确定要删除选中的 ${selectedBubbles.size} 条消息吗？`)) {
    // 从大到小删除，避免索引变化问题
    const sortedIndices = Array.from(selectedBubbles).sort((a, b) => b - a);
    sortedIndices.forEach(index => {
      messages.splice(index, 1);
    });
    
    clearAllSelections();
    renderChat();
    showCopyToast('选中的消息已删除');
  }
}

/* 全局点击事件，取消代码块选中状态 */
document.addEventListener('click', (e) => {
  // 如果点击的不是代码块，则取消所有代码块的选中状态
  if (!e.target.closest('.enhanced-code-block')) {
    document.querySelectorAll('.enhanced-code-block.selected').forEach(block => {
      block.classList.remove('selected');
    });
  }
});

/* 读取 JSON 文件 */
fileInput.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  loadJsonStreaming(f);
});

/* 搜索功能 */
function performSearch(term) {
  searchTerm = term.toLowerCase().trim();
  searchHighlights = [];
  currentSearchIndex = -1;   // 默认 -1 表示尚未定位
  totalSearchResults = 0;

  // 重新初始化缓存与队列
  searchQueue = [];
  conversations.forEach(conv => {
    conv._searchCache = null;
    conv._searchPending = false;
  });

  if (!searchTerm) {
    searchNavigation.style.display = 'none';
    // 清空搜索时移除搜索状态，恢复毛玻璃效果
    document.body.classList.remove('search-active');
    renderConvList();
    renderChat();
    updateMobileFrosted();
    return;
  }

  // 开启搜索时添加搜索状态类
  document.body.classList.add('search-active');

  // 初步渲染（仅根据标题匹配）
  renderConvList();

  // 排队待异步扫描所有对话内容
  conversations.forEach(conv => {
    if (!conv._searchPending) {
      conv._searchPending = true;
      searchQueue.push(conv);
    }
  });
  scheduleSearchBatch();

  // 如果有选中的会话，搜索并高亮聊天内容
  if (activeIdx !== null) {
    renderChat();
    updateSearchResults();
  } else {
    searchNavigation.style.display = 'none';
  }
  updateMobileFrosted();
}

/* 更新搜索结果计数和导航 */
function updateSearchResults() {
  if (!searchTerm || activeIdx === null) {
    searchNavigation.style.display = 'none';
    return;
  }
  
  // 计算所有匹配的搜索结果（包括同一消息中的多个匹配）
  searchHighlights = [];
  messages.forEach((message, messageIndex) => {
    if (messageMatchesSearch(message)) {
      // 计算这条消息中有多少个匹配
      const replaced = applyReplacements(message.text || '');
      const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = [...replaced.matchAll(regex)];
      
      // 为每个匹配创建一个搜索结果项
      matches.forEach((match, matchIndex) => {
        searchHighlights.push({
          messageIndex: messageIndex,
          matchIndex: matchIndex,
          matchStart: match.index,
          matchText: match[0]
        });
      });
    }
  });
  
  totalSearchResults = searchHighlights.length;
  
  if (totalSearchResults > 0) {
    searchNavigation.style.display = 'flex';
    // 若当前索引超界则重置为最后一个；保留 -1 代表未定位
    if (currentSearchIndex >= totalSearchResults) {
      currentSearchIndex = totalSearchResults - 1;
    }
    const displayIdx = currentSearchIndex >= 0 ? currentSearchIndex + 1 : 1;
    
    // 更新输入框和总数显示
    const indexInput = document.getElementById('search-index-input');
    const totalInput = document.getElementById('search-total');
    
    if (indexInput) {
      indexInput.value = displayIdx;
      indexInput.max = totalSearchResults;
    }
    if (totalInput) {
      totalInput.value = totalSearchResults;
    }
    
    // 更新按钮状态
    searchPrev.disabled = currentSearchIndex <= 0;
    searchNext.disabled = currentSearchIndex >= totalSearchResults - 1;
  } else {
    searchNavigation.style.display = 'none';
  }
}

/* 高亮搜索结果 */
function highlightSearchText(text, className = 'search-highlight') {
  if (!searchTerm || !text) return text;
  
  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, `<mark class="${className}">$1</mark>`);
}

/* 检查对话框是否匹配搜索 */
function conversationMatchesSearch(conv) {
  if (!searchTerm) return true;

  // 名称匹配立即返回
  if (conv.name && conv.name.toLowerCase().includes(searchTerm)) {
    return true;
  }

  // 如果已有缓存且是当前搜索词，直接返回结果
  if (conv._searchCache && conv._searchCache.term === searchTerm) {
    return conv._searchCache.match;
  }

  // 尚未扫描完的先暂时保留，待异步扫描后再决定
  if (!conv._searchPending) {
    conv._searchPending = true;
    searchQueue.push(conv);
    scheduleSearchBatch();
  }
  return true;   // 先展示，稍后再刷新真实匹配结果
}

/* 检查消息是否匹配搜索 */
function messageMatchesSearch(message) {
  if (!searchTerm) return true;
  return applyReplacements(message.text || '').toLowerCase().includes(searchTerm);
}

/* 搜索导航事件处理 */
searchPrev.addEventListener('click', () => {
  if (currentSearchIndex > 0) {
    currentSearchIndex--;
    updateSearchResults();
    scrollToSearchResult();
  }
});

searchNext.addEventListener('click', () => {
  if (currentSearchIndex < totalSearchResults - 1) {
    currentSearchIndex++;
    updateSearchResults();
    scrollToSearchResult();
  }
});

/* 滚动到当前搜索结果 */
function scrollToSearchResult() {
  if (!searchTerm || totalSearchResults === 0 || currentSearchIndex < 0) return;
  
  if (currentSearchIndex < searchHighlights.length) {
    const highlight = searchHighlights[currentSearchIndex];
    const targetMessageIndex = highlight.messageIndex;
    
    // 获取所有消息元素
    const messageElements = chatPanel.querySelectorAll('.msg');
    
    // 滚动到对应的消息元素
    if (messageElements[targetMessageIndex]) {
      messageElements[targetMessageIndex].scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
      
      // 添加临时高亮效果
      messageElements[targetMessageIndex].style.backgroundColor = 'rgba(59,130,246,0.1)';
      setTimeout(() => {
        messageElements[targetMessageIndex].style.backgroundColor = '';
      }, 1000);
    }
  }
}

/* ============ 增量搜索相关 ============ */
function scheduleSearchBatch() {
  // 如果没有排队或搜索词为空则跳过
  if (!searchTerm || searchQueue.length === 0) return;

  const process = (deadline) => {
    // deadline 可能不存在（setTimeout 回退）
    while ((deadline ? deadline.timeRemaining() > 0 : true) && searchQueue.length) {
      const conv = searchQueue.shift();
      conv._searchPending = false;
      // 扫描消息
      const msgs = conv.chat_messages || [];
      const matched = msgs.some(msg => applyReplacements(msg.text || '').toLowerCase().includes(searchTerm));
      conv._searchCache = { term: searchTerm, match: matched };
    }
    // 扫完一批后刷新列表
    renderConvList();
    // 继续排队
    if (searchQueue.length > 0) {
      if (window.requestIdleCallback) {
        requestIdleCallback(process);
      } else {
        setTimeout(() => process(), 0);
      }
    }
  };

  if (window.requestIdleCallback) {
    requestIdleCallback(process);
  } else {
    setTimeout(() => process(), 0);
  }
}

/* ============ 会话 Tooltip ============ */
function showConvTooltip(btn, conv){
  hideConvTooltip();
  convHoverTooltip = document.createElement('div');
  convHoverTooltip.className = 'conv-tooltip show';
  const createdMillis  = conv.created_at ? +new Date(conv.created_at) : firstMillis(conv);
  const updatedMillis  = conv.updated_at ? +new Date(conv.updated_at) : lastMillis(conv);
  const createdAt = createdMillis ? fmt(createdMillis) : '未知';
  const updatedAt = updatedMillis ? fmt(updatedMillis) : '未知';
  convHoverTooltip.innerHTML = `<div><strong>创建时间：</strong>${createdAt}</div><div><strong>更新时间：</strong>${updatedAt}</div>`;
  document.body.appendChild(convHoverTooltip);

  // 初始定位：鼠标偏移
  const rect = btn.getBoundingClientRect();
  convHoverTooltip.style.position='fixed';
  convHoverTooltip.style.left = (rect.right + 8) + 'px';
  convHoverTooltip.style.top  = (rect.top) + 'px';
}

function hideConvTooltip(){
  if(convHoverTooltip){
    convHoverTooltip.remove();
    convHoverTooltip = null;
  }
}

/* ============ 移动端对话框时间信息 ============ */
let convTimeInfo = null;

function showConvTimeInfo(buttonElement, conv) {
  // 关闭之前的时间信息
  hideConvTimeInfo();
  
  const createdMillis = conv.created_at ? +new Date(conv.created_at) : firstMillis(conv);
  const updatedMillis = conv.updated_at ? +new Date(conv.updated_at) : lastMillis(conv);
  const createdAt = createdMillis ? fmt(createdMillis) : '未知';
  const updatedAt = updatedMillis ? fmt(updatedMillis) : '未知';
  
  convTimeInfo = document.createElement('div');
  convTimeInfo.className = 'conv-time-info';
  convTimeInfo.innerHTML = `
    <div class="time-info-header">
      <strong>${conv.name}</strong>
    </div>
    <div class="time-info-content">
      <div class="time-item">
        <span class="time-label">创建时间</span>
        <span class="time-value">${createdAt}</span>
      </div>
      <div class="time-item">
        <span class="time-label">更新时间</span>
        <span class="time-value">${updatedAt}</span>
      </div>
    </div>
  `;
  
  // 添加点击关闭功能
  convTimeInfo.addEventListener('click', hideConvTimeInfo);
  
  document.body.appendChild(convTimeInfo);
  
  // 定位到按钮下方
  const rect = buttonElement.getBoundingClientRect();
  convTimeInfo.style.top = (rect.bottom + 8) + 'px';
  convTimeInfo.style.left = rect.left + 'px';
  
  // 确保不超出屏幕右边界
  setTimeout(() => {
    const infoRect = convTimeInfo.getBoundingClientRect();
    if (infoRect.right > window.innerWidth - 10) {
      convTimeInfo.style.left = (window.innerWidth - infoRect.width - 10) + 'px';
    }
  }, 0);
}

function hideConvTimeInfo() {
  if (convTimeInfo) {
    convTimeInfo.remove();
    convTimeInfo = null;
  }
}

/* ============ 代码块处理函数 ============ */
function enhanceCodeBlocks(bubble) {
  const msg = bubble._message;
  let analysisAttached = false;
  const codeBlocks = bubble.querySelectorAll('pre code');
  codeBlocks.forEach((codeBlock, index) => {
    const preElement = codeBlock.parentElement;

    preElement.classList.add('enhanced-code-block');
    preElement.setAttribute('data-code-index', index);

    // web search 数据
    if (msg && msg._webSearch && codeBlock.textContent.includes('web search')) {
      preElement.dataset.query = msg._webSearch.query;
      preElement.dataset.results = JSON.stringify(msg._webSearch.results||[]);
      preElement.classList.add('web-search-block');
      preElement.setAttribute('data-search-type','web');
    }

    // analysis tool 数据，只附加一次
    if(!analysisAttached && msg && msg._analysisTool){
       preElement.dataset.analysis = msg._analysisTool.code;
       preElement.classList.add('analysis-tool-block');
       analysisAttached = true;
    }

    // artifacts 数据
    if(msg && msg._artifactsTool && codeBlock.textContent.includes('artifacts')){
        preElement.dataset.artifactsTitle = msg._artifactsTool.title;
        preElement.dataset.artifactsContent = msg._artifactsTool.content;
        preElement.classList.add('artifacts-tool-block');
    }

    // 点击选中 / 弹卡片
    preElement.addEventListener('click', (e) => {
      document.querySelectorAll('.enhanced-code-block.selected').forEach(b=>b.classList.remove('selected'));
      preElement.classList.add('selected');
      if(preElement.classList.contains('web-search-block') || preElement.classList.contains('analysis-tool-block') || preElement.classList.contains('artifacts-tool-block')){
        showCodeBlockCard(preElement,e);
      }
      e.stopPropagation();
    });
  });
}

/* ============ 复制提示函数 ============ */
function showCopyToast(message) {
  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #10b981;
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transform: translateX(100%);
    transition: transform 0.3s ease;
  `;
  
  document.body.appendChild(toast);
  
  // 动画显示
  setTimeout(() => {
    toast.style.transform = 'translateX(0)';
  }, 10);
  
  // 3秒后自动消失
  setTimeout(() => {
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 300);
  }, 3000);
}

/* 搜索功能增强 - 支持代码块定位 */
function findCodeBlocks(searchTerm) {
  const codeBlocks = document.querySelectorAll('.enhanced-code-block code');
  const matches = [];
  
  codeBlocks.forEach((codeBlock, index) => {
    if (codeBlock.textContent.toLowerCase().includes(searchTerm.toLowerCase())) {
      matches.push({
        element: codeBlock.parentElement,
        index: index,
        text: codeBlock.textContent.substring(0, 50) + '...'
      });
    }
  });
  
  return matches;
}

/* ============ 提取 web_search 数据 ============ */
function extractToolData(msg){
  if(!msg || !Array.isArray(msg.content)) return;
  let query=null;
  let results=[];
  let analysisCode='';
  msg.content.forEach(c=>{
    if(c && c.type==='tool_use'){
        if(c.name==='web_search') {
           query = c.input?.query||'';
        } else if(c.name==='repl') {
           analysisCode = c.input?.code||'';
        } else if(c.name==='artifacts') {
           const t=c.input?.title||''; const cont=c.input?.content||'';
           msg._artifactsTool = {title:t, content: cont};
        }
    } else if(c && c.type==='tool_result' && c.name==='web_search'){
        const arr = Array.isArray(c.content)?c.content:[];
        results = arr.filter(k=>k && k.title && k.url).map(k=>({title:k.title,url:k.url,site:(k.metadata?.site_name||'')}));
    }
  });
  if(query){ msg._webSearch = {query,results}; }
  if(analysisCode){ msg._analysisTool = {code: analysisCode}; }
}

/* ============ web search 卡片 ============ */
function showCodeBlockCard(preElement, evt){
  if(currentCard){ currentCard.remove(); currentCard=null; }
  const isWeb = preElement.classList.contains('web-search-block');
  const isAnalysis = preElement.classList.contains('analysis-tool-block');

  const query = preElement.dataset.query || '';
  let results = [];
  try{ results = JSON.parse(preElement.dataset.results||'[]'); }catch{}
  const analysisCode = preElement.dataset.analysis || '';
  const artifactsTitle = preElement.dataset.artifactsTitle || '';
  const artifactsContent = preElement.dataset.artifactsContent || '';

  const card = document.createElement('div');
  card.className = 'code-block-card';
  let bodyHtml='';
  if(isWeb){
     const resultsHtml = results.length ? results.map(r=>{
          const safeSite = r.site ? ` <span style=\"color:#6b7280\">(${r.site})</span>` : '';
          return `<div class=\"result-item\"><strong>${r.title}</strong>${safeSite}<br/><a href=\"${r.url}\" target=\"_blank\">${r.url}</a></div>`;
     }).join('') : '<div style="color:#6b7280;font-size:13px">暂无搜索结果</div>';
     bodyHtml = `
       <div class=\"card-section tool-name\"><div class=\"section-label\">工具名称</div><div class=\"section-content\">🔍 Web Search</div></div>
       <div class=\"card-section search-title\"><div class=\"section-label\">搜索</div><div class=\"section-content\">${query}</div></div>
       <div class=\"card-section content\"><div class=\"section-label\">内容</div><div class=\"section-content\">${resultsHtml}</div></div>`;
  }else if(isAnalysis){
     const codeHtml = `<pre style=\"background:#f1f5f9;padding:12px;border-radius:6px;white-space:pre-wrap;overflow:auto;font-size:13px\">${analysisCode.replace(/[&<>]/g, t=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[t]))}</pre>`;
     bodyHtml = `
       <div class=\"card-section tool-name\"><div class=\"section-label\">工具名称</div><div class=\"section-content\">🧮 Analysis tool</div></div>
       <div class=\"card-section content\"><div class=\"section-label\">代码</div><div class=\"section-content\">${codeHtml}</div></div>`;
  }else if(preElement.classList.contains('artifacts-tool-block')){
     const contentHtml = marked.parse(artifactsContent || '');
     bodyHtml = `
       <div class=\"card-section tool-name\"><div class=\"section-label\">工具名称</div><div class=\"section-content\">📄 Artifacts</div></div>
       <div class=\"card-section search-title\"><div class=\"section-label\">标题</div><div class=\"section-content\"><strong>${artifactsTitle}</strong></div></div>
       <div class=\"card-section content\"><div class=\"section-label\">内容</div><div class=\"section-content\">${contentHtml}</div></div>`;
  }
  card.innerHTML = `
    <div class=\"card-header\">
      <div class=\"drag-handle\" title=\"拖拽移动\">⋮⋮</div>
      <button class=\"close-btn\" title=\"关闭\">✕</button>
    </div>
    <div class=\"card-body\">${bodyHtml}</div>
    <div class=\"resize-handle resize-handle-right\" title=\"拖拽调整宽度\"></div>
    <div class=\"resize-handle resize-handle-bottom\" title=\"拖拽调整高度\"></div>
    <div class=\"resize-handle resize-handle-corner\" title=\"拖拽调整大小\"></div>`;
  document.body.appendChild(card);
  const clickX = evt?.clientX || window.innerWidth/2;
  const clickY = evt?.clientY || window.innerHeight/2;
  card.style.left = Math.min(clickX, window.innerWidth - 320) + 'px';
  card.style.top = Math.min(clickY, window.innerHeight - 400) + 'px';
  currentCard = card;
  card.querySelector('.close-btn').onclick = () => { card.remove(); currentCard=null; };
  
  // 拖拽移动 - 支持鼠标和触摸
  const handle = card.querySelector('.drag-handle');
  let dragging=false,startX=0,startY=0,startL=0,startT=0;
  
  function startDrag(e) {
    dragging=true;
    const clientX = e.clientX || e.touches[0].clientX;
    const clientY = e.clientY || e.touches[0].clientY;
    startX=clientX;
    startY=clientY;
    startL=parseInt(card.style.left);
    startT=parseInt(card.style.top);
    
    // 添加鼠标和触摸事件监听
    document.addEventListener('mousemove',move);
    document.addEventListener('mouseup',up);
    document.addEventListener('touchmove',move,{passive:false});
    document.addEventListener('touchend',up);
    e.preventDefault();
  }
  
  function move(e){
    if(!dragging)return;
    const clientX = e.clientX || e.touches[0].clientX;
    const clientY = e.clientY || e.touches[0].clientY;
    const dx=clientX-startX,dy=clientY-startY;
    card.style.left=Math.max(0,Math.min(window.innerWidth-card.offsetWidth,startL+dx))+"px";
    card.style.top=Math.max(0,Math.min(window.innerHeight-card.offsetHeight,startT+dy))+"px";
    e.preventDefault();
  }
  
  function up(){
    dragging=false;
    document.removeEventListener('mousemove',move);
    document.removeEventListener('mouseup',up);
    document.removeEventListener('touchmove',move);
    document.removeEventListener('touchend',up);
  }
  
  handle.addEventListener('mousedown',startDrag);
  handle.addEventListener('touchstart',startDrag);
  
  // 调整大小
  setupResizeHandles(card);
}
/* ============ 卡片调整大小功能 ============ */
function setupResizeHandles(card) {
  const rightHandle = card.querySelector('.resize-handle-right');
  const bottomHandle = card.querySelector('.resize-handle-bottom');
  const cornerHandle = card.querySelector('.resize-handle-corner');
  
  let isResizing = false;
  let resizeType = '';
  let startX = 0, startY = 0;
  let startWidth = 0, startHeight = 0;
  
  function startResize(e, type) {
    isResizing = true;
    resizeType = type;
    const clientX = e.clientX || e.touches[0].clientX;
    const clientY = e.clientY || e.touches[0].clientY;
    startX = clientX;
    startY = clientY;
    startWidth = parseInt(document.defaultView.getComputedStyle(card).width, 10);
    startHeight = parseInt(document.defaultView.getComputedStyle(card).height, 10);
    card.classList.add('resizing');
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('touchmove', doResize, {passive:false});
    document.addEventListener('touchend', stopResize);
    e.preventDefault();
  }
  
  function doResize(e) {
    if (!isResizing) return;
    
    const clientX = e.clientX || e.touches[0].clientX;
    const clientY = e.clientY || e.touches[0].clientY;
    const dx = clientX - startX;
    const dy = clientY - startY;
    
    if (resizeType === 'right' || resizeType === 'corner') {
      const newWidth = Math.max(200, Math.min(window.innerWidth * 0.9, startWidth + dx));
      card.style.width = newWidth + 'px';
    }
    
    if (resizeType === 'bottom' || resizeType === 'corner') {
      const newHeight = Math.max(150, Math.min(window.innerHeight * 0.9, startHeight + dy));
      card.style.height = newHeight + 'px';
    }
    
    e.preventDefault();
  }
  
  function stopResize() {
    isResizing = false;
    resizeType = '';
    card.classList.remove('resizing');
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
    document.removeEventListener('touchmove', doResize);
    document.removeEventListener('touchend', stopResize);
  }
  
  // 添加鼠标和触摸事件
  rightHandle.addEventListener('mousedown', e => startResize(e, 'right'));
  rightHandle.addEventListener('touchstart', e => startResize(e, 'right'));
  bottomHandle.addEventListener('mousedown', e => startResize(e, 'bottom'));
  bottomHandle.addEventListener('touchstart', e => startResize(e, 'bottom'));
  cornerHandle.addEventListener('mousedown', e => startResize(e, 'corner'));
  cornerHandle.addEventListener('touchstart', e => startResize(e, 'corner'));
}

// ESC键处理
document.addEventListener('keydown',e=>{ 
  if(e.key==='Escape') {
    if(currentCard) { 
      currentCard.remove(); 
      currentCard=null; 
    } else if(isInSelectionMode) {
      exitSelectionMode();
    } else if(multiSelectMenu) {
      closeMultiSelectMenu();
    } else if(convTimeInfo) {
      hideConvTimeInfo();
    }
  }
});

/* 切换选择模式 */
function toggleSelectMode(){
  isSelectMode = !isSelectMode;
  
  if(isSelectMode){
    selectModeBtn.textContent = '✖️ 取消';
    selectToggleBtn.style.display = 'inline-block';
  } else {
    selectModeBtn.textContent = '☑️ 选择';
    selectToggleBtn.style.display = 'none';
    // 退出选择模式时清空所有选择
    conversations.forEach(c => c._selected = false);
  }
  
  renderConvList();
  updateExportButtons();
}

/* 切换全选/全不选 */
function toggleSelectAll(){
  if(conversations.length===0) return;
  const allSelected = conversations.every(c=>c._selected);
  conversations.forEach(c=>c._selected = !allSelected);
  renderConvList();
  updateExportButtons();
}

function updateSelectToggleState(){
  if(!selectToggleBtn || !isSelectMode) return;
  if(conversations.length===0){ selectToggleBtn.style.display='none'; return; }
  selectToggleBtn.style.display='inline-block';
  const allSelected = conversations.length>0 && conversations.every(c=>c._selected);
  selectToggleBtn.textContent = allSelected ? '❌ 全不选' : '✅ 全选会话';
}

/* ============ 设备 + 搜索状态辅助 ============ */
function isMobile() {
  return window.matchMedia('(max-width: 768px)').matches;
}
function updateMobileFrosted() {
  if (window.innerWidth <= 768) {
    // 移动端始终保持毛玻璃效果，除非在搜索状态
    if (!document.body.classList.contains('search-active')) {
      document.body.classList.add('mobile-frosted');
    } else {
      document.body.classList.remove('mobile-frosted');
    }
  } else {
    // 桌面端移除移动端毛玻璃效果
    document.body.classList.remove('mobile-frosted');
  }
}
