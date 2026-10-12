<script setup lang="ts">
/**
 * 休息日的小人（2026-10-12 用户看样稿后要的）：圆头小人两手枕在脑后，翘着腿惬意地躺着，头顶飘两个 z。
 * 周视图的休息格、右牌计划面的休息行都用它。颜色全走 token（睡眠紫），深浅两套主题各一组明暗。
 */
withDefaults(defineProps<{ size?: number }>(), { size: 64 });
</script>

<template>
  <svg class="rest-figure" :width="size" :height="size * 0.56" viewBox="0 0 100 56" aria-hidden="true" focusable="false">
    <ellipse class="shadow" cx="52" cy="50" rx="40" ry="3.6" />
    <!-- 枕在脑后的胳膊：肘尖朝上，在头后面 -->
    <path class="limb back" d="M33 39 L27 23 L19 31" />
    <!-- 身子 -->
    <rect class="shirt" x="29" y="34" width="34" height="14" rx="7" />
    <path class="shine" d="M35 36.5 h20" />
    <!-- 伸直的那条腿 -->
    <path class="limb pants" d="M60 43 L88 45" />
    <!-- 翘起来的那条腿 -->
    <path class="limb pants front" d="M60 41 L73 27 L84 37" />
    <circle class="shoe" cx="89.5" cy="44.6" r="3.6" />
    <circle class="shoe" cx="85.5" cy="36.4" r="3.6" />
    <!-- 头 -->
    <circle class="head" cx="20" cy="38" r="10" />
    <ellipse class="glint" cx="16.4" cy="33.6" rx="3.4" ry="2.2" transform="rotate(-28 16.4 33.6)" />
    <path class="limb front-arm" d="M34 38 L30 25 L24 30" />
    <!-- 头顶的 z -->
    <path class="zz" d="M30 10 h5 l-5 6 h5" />
    <path class="zz small" d="M39 3 h3.4 l-3.4 4 h3.4" />
  </svg>
</template>

<style scoped>
.rest-figure {
  --rf-skin: color-mix(in srgb, var(--sleep) 38%, #f3eadf);
  --rf-shirt: var(--sleep);
  --rf-pants: color-mix(in srgb, var(--sleep) 55%, #1b1f33);
  --rf-shoe: color-mix(in srgb, var(--sleep) 30%, #0f1220);
  display: block;
  overflow: visible;
}
:root[data-theme='light'] .rest-figure {
  --rf-skin: color-mix(in srgb, var(--sleep) 22%, #ffe9d6);
  --rf-pants: color-mix(in srgb, var(--sleep) 70%, #2b2f4a);
  --rf-shoe: color-mix(in srgb, var(--sleep) 45%, #2b2f4a);
}
.shadow { fill: color-mix(in srgb, var(--ink) 9%, transparent); }
.limb { fill: none; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
.back { stroke: color-mix(in srgb, var(--rf-skin) 72%, var(--rf-shoe)); }
.front-arm { stroke: var(--rf-skin); stroke-width: 6.4; }
.pants { stroke: var(--rf-pants); stroke-width: 8; }
.pants.front { stroke: color-mix(in srgb, var(--rf-pants) 82%, #fff); }
.shirt { fill: var(--rf-shirt); }
.shine { fill: none; stroke: #fff; stroke-opacity: .35; stroke-width: 2; stroke-linecap: round; }
.shoe { fill: var(--rf-shoe); }
.head { fill: var(--rf-skin); }
.glint { fill: #fff; opacity: .55; }
.zz { fill: none; stroke: var(--sleep); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; opacity: .9; }
.zz.small { stroke-width: 1.6; opacity: .6; }
</style>
