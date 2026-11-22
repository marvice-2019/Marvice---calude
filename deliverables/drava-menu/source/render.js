const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const dir = __dirname;
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + path.join(dir, 'menu.html'));
  await p.evaluate(() => document.fonts.ready);
  // overflow check: any page whose content exceeds its box
  const over = await p.evaluate(() => [...document.querySelectorAll('.page')].map(pg => {
    const r = pg.getBoundingClientRect();
    const cols = pg.querySelector('.cols');
    return { pageH: r.height, scrollH: pg.scrollHeight, colsOverflowX: cols.scrollWidth > cols.clientWidth + 1 };
  }));
  console.log(JSON.stringify(over));
  await p.pdf({ path: path.join(dir, 'DRAVA_Beverage_Menu.pdf'), preferCSSPageSize: true, printBackground: true });
  await b.close();
})();
