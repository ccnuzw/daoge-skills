const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGeneratedPrompts } = require('../../src/domain/prompt_builder');

test('prompt builder keeps non-people ecommerce prompts free of portrait wardrobe leakage', () => {
  const prompts = buildGeneratedPrompts({
    taskSpec: {
      content_brief: '无糖气泡水电商商品主图，突出青柠口味、透明瓶身、水珠和白底平台安全区',
      total_count: 2,
      width: 1024,
      height: 1024,
    },
  });
  assert.equal(prompts.length, 2);
  prompts.forEach((prompt) => {
    assert.equal(Object.prototype.hasOwnProperty.call(prompt, 'wardrobe'), false);
    assert.equal(typeof prompt.visual_focus, 'string');
    assert.doesNotMatch(prompt.generation_prompt, /wardrobe|portrait|人物主视觉|distorted hands|broken anatomy/i);
    assert.match(prompt.generation_prompt, /商品主体|电商转化素材|方图构图|平台/);
  });
});

test('prompt builder distributes variation requirements per prompt', () => {
  const prompts = buildGeneratedPrompts({
    taskSpec: {
      content_brief: '咖啡新品上市 campaign 海报，主视觉是冷萃瓶和冰块',
      total_count: 3,
      width: 1024,
      height: 1536,
      variation_requirements: ['低角度产品英雄图', '俯拍冰块细节', '强标题区留白'],
    },
  });
  assert.match(prompts[0].generation_prompt, /低角度产品英雄图/);
  assert.doesNotMatch(prompts[0].generation_prompt, /俯拍冰块细节|强标题区留白/);
  assert.match(prompts[1].generation_prompt, /俯拍冰块细节/);
  assert.doesNotMatch(prompts[1].generation_prompt, /低角度产品英雄图|强标题区留白/);
  assert.match(prompts[2].generation_prompt, /强标题区留白/);
  assert.doesNotMatch(prompts[2].generation_prompt, /低角度产品英雄图|俯拍冰块细节/);
});

test('prompt builder lets size and ratio affect composition wording', () => {
  const horizontal = buildGeneratedPrompts({
    taskSpec: {
      content_brief: '横图 banner，户外运动鞋新品首发，右侧留购买按钮区域',
      total_count: 1,
      width: 1536,
      height: 1024,
    },
  })[0];
  const vertical = buildGeneratedPrompts({
    taskSpec: {
      content_brief: '竖版短视频封面，顶部标题安全区，中间食物主视觉',
      total_count: 1,
      width: 1024,
      height: 1536,
    },
  })[0];
  assert.match(horizontal.generation_prompt, /横图构图|左右安全区域/);
  assert.match(vertical.generation_prompt, /竖版构图|标题安全区/);
});
