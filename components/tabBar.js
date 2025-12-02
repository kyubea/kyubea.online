const tabBarHTML = `
<div class="tab-bar">
    <a href="index.html" class="tab">portfolio</a>
    <a href="chat.html" class="tab">live chat demo</a>
    <a href="https://github.com/kyubea" class="tab" target="_blank" rel="noopener">github</a>
</div>
`;

function insertTabBar() {
    document.body.insertAdjacentHTML('afterbegin', tabBarHTML);
    TabBar.initialize();
}