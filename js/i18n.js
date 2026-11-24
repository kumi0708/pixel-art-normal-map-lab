export const I18N = {
  ja: {
    subtitle: 'ピクセルアートの<b>アウトライン（シルエット）だけ</b>から法線マップを生成し、2Dライティングをリアルタイムで確認するラボ',
    source: '元記事',
    hint: 'マウス移動 = ライト ／ スプライトをドラッグ = 移動 ／ クリック = 詳細表示 ／ ダブルクリック = ライトを置く',
    viewLit: 'ライティング', viewAlbedo: 'アルベド', viewNormal: '法線マップ', viewHeight: '高さ', viewLight: 'ライトのみ',
    compare: '左半分をフラット法線で比較', flipY: '緑チャンネル反転（規約ミスの再現）', spriteLights: 'スプライトの発光', animate: 'アニメーション',
    clearLights: '置いたライトを消す',
    secSprite: 'スプライト', secGen: '生成パラメータ', secLight: 'ライティング', secFile: 'ファイル',
    bevel: 'ベベル幅 bevel (px)', top: '頂上の高さ top (px)', detail: '明度ディテール detail', sigma: 'ぼかし σ',
    boxy: '箱型ルール top = 12·bevel/5', reset: '既定値に戻す',
    steps: '階調ステップ steps (0 = なめらか)', lheight: 'ライトの高さ z (px)', radius: '半径 radius (px)', energy: '強さ energy',
    lcolor: 'ライト色', ambient: '環境光',
    upload: '自分のPNGを読み込む', downloadN: '法線マップPNGを保存', downloadH: '高さマップPNGを保存',
    uploadNote: 'ハードエッジ（アルファ 0/255）のスプライト推奨。128px を超える場合は縮小されます。',
    secInspector: 'パイプライン可視化',
    st1: '① 入力 (アルファ > 127)', st2: '② 距離 r = d / bevel', st3: '③ 高さ（ベベル + 明度 → ぼかし）', st4: '④ 法線マップ', st5: '⑤ ライティング',
    readoutIdle: 'ピクセルにカーソルを合わせると値が表示されます',
    secHow: 'しくみ',
    how: `
<ol class="how">
<li><b>内側マスク</b> — アルファが 127 より大きい画素を「内側」とみなす。周囲に透明な 1px を足し、キャンバスの端も輪郭として扱う。</li>
<li><b>ユークリッド距離変換</b> — 内側の各画素から一番近い外側画素までの距離 <code>d</code> を正確に求める（Felzenszwalb–Huttenlocher の O(n) アルゴリズム）。</li>
<li><b>四分円ベベル</b> — <code>r = clamp(d / bevel)</code>、<code>h = top · √(1 − (1 − r)²)</code>。縁は急で、上は平らな「クッション」形になる。</li>
<li><b>明度ディテール</b> — <code>h += detail · (L − 平均L)</code>。暗い線は溝に、明るい部分は少し盛り上がる。</li>
<li><b>ガウスぼかし σ=0.7</b> のあと中心差分で勾配を取り、<code>n = normalize(−∂h/∂x, ∂h/∂y, 1)</code>。行は下向きなので +y が「上」になる。</li>
<li><b>エンコード</b> — <code>rgb = (n · 0.5 + 0.5) · 255</code>。平らな面は (128,128,255)。</li>
<li><b>ライティング</b> — <code>falloff = (1 − dist/radius)^1.2</code>、<code>lit = falloff · max(n·L, 0)</code>、<code>ceil(lit·steps)/steps</code> でトゥーン階調にし、<code>albedo · (ambient + color · energy · lit)</code>。</li>
<li><b>床タイル</b> — 3×3 に並べ、<code>blur(gray, 0.8) > 30パーセンタイル</code> を石のマスクにして同じ処理（bevel 3, top 2.5, detail 1.0）を行い、中央タイルを切り出すのでシームレス。</li>
</ol>`,
    footer: 'アルゴリズムは SpriteCook のブログ記事に基づく独自実装です。スプライトはすべてコードで描いています。',
  },
  en: {
    subtitle: 'Generate normal maps for pixel art <b>from the outline alone</b> and preview 2D lighting in real time',
    source: 'Original article',
    hint: 'Move mouse = light / drag a sprite = move / click = inspect / double-click = place a light',
    viewLit: 'Lit', viewAlbedo: 'Albedo', viewNormal: 'Normal map', viewHeight: 'Height', viewLight: 'Light only',
    compare: 'Compare: flat normals on the left half', flipY: 'Flip green (simulate a convention bug)', spriteLights: 'Sprite lights', animate: 'Animate',
    clearLights: 'Clear placed lights',
    secSprite: 'Sprite', secGen: 'Generation', secLight: 'Lighting', secFile: 'Files',
    bevel: 'Bevel width (px)', top: 'Top height (px)', detail: 'Brightness detail', sigma: 'Blur σ',
    boxy: 'Boxy rule top = 12·bevel/5', reset: 'Reset to defaults',
    steps: 'Light steps (0 = smooth)', lheight: 'Light height z (px)', radius: 'Radius (px)', energy: 'Energy',
    lcolor: 'Light colour', ambient: 'Ambient',
    upload: 'Load your own PNG', downloadN: 'Save normal map PNG', downloadH: 'Save height map PNG',
    uploadNote: 'Hard-edged sprites (alpha 0/255) work best. Images larger than 128px are downscaled.',
    secInspector: 'Pipeline inspector',
    st1: '① Input (alpha > 127)', st2: '② Distance r = d / bevel', st3: '③ Height (bevel + luma → blur)', st4: '④ Normal map', st5: '⑤ Lit',
    readoutIdle: 'Hover a pixel to read its values',
    secHow: 'How it works',
    how: `
<ol class="how">
<li><b>Inside mask</b> — pixels with alpha &gt; 127 are inside. A 1px transparent border is added so the canvas edge also counts as an outline.</li>
<li><b>Euclidean distance transform</b> — exact distance <code>d</code> from each inside pixel to the nearest outside pixel (Felzenszwalb–Huttenlocher, linear time).</li>
<li><b>Quarter-circle bevel</b> — <code>r = clamp(d / bevel)</code>, <code>h = top · √(1 − (1 − r)²)</code>: steep at the rim, flat on top.</li>
<li><b>Brightness detail</b> — <code>h += detail · (L − mean L)</code>: dark lines become grooves, highlights bulge slightly.</li>
<li><b>Gaussian blur σ=0.7</b>, then central-difference gradients, <code>n = normalize(−∂h/∂x, ∂h/∂y, 1)</code>. Rows go down, so +y ends up meaning “up”.</li>
<li><b>Encode</b> — <code>rgb = (n · 0.5 + 0.5) · 255</code>. Flat is (128,128,255).</li>
<li><b>Lighting</b> — <code>falloff = (1 − dist/radius)^1.2</code>, <code>lit = falloff · max(n·L, 0)</code>, banded with <code>ceil(lit·steps)/steps</code>, then <code>albedo · (ambient + color · energy · lit)</code>.</li>
<li><b>Floor tiles</b> — tiled 3×3, stones = <code>blur(gray, 0.8) &gt; 30th percentile</code>, same pipeline (bevel 3, top 2.5, detail 1.0), centre tile cropped, so it stays seamless.</li>
</ol>`,
    footer: 'Independent implementation of the algorithm described in a SpriteCook blog post. All sprites are drawn in code.',
  },
};
