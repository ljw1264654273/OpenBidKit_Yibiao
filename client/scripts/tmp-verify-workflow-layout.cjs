const { chromium } = require('C:/Users/admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/3dd31cfff853001c/bin/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.body.innerHTML = `
      <div class="app-shell"><aside class="sidebar"></aside><main class="main-area">
        <section class="content-shell"><div class="page-stack technical-workbench technical-workbench-global-scroll">
          <section class="technical-plan-stage-panel"><nav class="technical-plan-stages">
            ${['选择标书', '文件解析', '目录生成', '事实设定', '生成正文'].map((label, index) => `
              <button class="technical-plan-stage${index === 0 ? ' is-current' : ' is-locked'}">
                <span>${String(index + 1).padStart(2, '0')}</span><strong>${label}</strong><small>${index === 0 ? '进行中' : '待开放'}</small>
              </button>`).join('')}
          </nav></section><section class="technical-step-module"></section>
        </div></section>
      </main></div>`;
  });

  const metrics = await page.evaluate(() => {
    const rect = (element) => element.getBoundingClientRect();
    const sidebar = rect(document.querySelector('.sidebar'));
    const root = rect(document.querySelector('.technical-workbench-global-scroll'));
    const panel = rect(document.querySelector('.technical-plan-stage-panel'));
    const cards = [...document.querySelectorAll('.technical-plan-stage')].map((card) => {
      const value = rect(card);
      return { left: value.left, right: value.right, width: value.width, height: value.height };
    });
    return {
      outerGap: root.left - sidebar.right,
      innerGap: cards[0].left - panel.left,
      trailingGap: panel.right - cards.at(-1).right,
      cardWidths: cards.map((card) => card.width),
      cardHeights: cards.map((card) => card.height),
      columnGaps: cards.slice(1).map((card, index) => card.left - cards[index].right),
    };
  });

  await page.screenshot({ path: 'tmp-workflow-layout.png', fullPage: true });
  console.log(JSON.stringify(metrics, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
