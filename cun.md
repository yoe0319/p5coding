let mainCharacter;
let passersby = [];
let tearTimer = 0;
let tearDrop = false;
let lastPasserbyTime = 0;


let video; // 摄像头视频流对象（不显示画面）
let poseNet; // PoseNet 姿态检测模型
let poses = []; // 存储检测到的人体姿态数据
let isWaving = false; // 挥手动作标记（true = 检测到挥手）
// 手腕位置历史（用于判断快速水平移动）

let leftWristHistory = []; 
let rightWristHistory = [];
const HISTORY_LENGTH = 10; // 记录最近10帧的手腕位置（约0.3秒）
const WAVE_THRESHOLD = 200; // 挥手判定阈值（水平移动超过80像素即判定为挥手）

let micActivated = false;

// 全局统一的慢速
const WALK_SPEED = 1;
const WALK_FRAME_SPEED = 0.05;

// ---------------------- 新增：控制标志显示的变量 ----------------------
let showWaveMarker = false; // 是否显示挥手标志
let markerTimer = 0; // 标志显示计时器（避免一直显示）
const MARKER_DURATION = 1500; // 标志显示时长（1.5秒）
// -------------------------------------------------------------------

let floatTextEffects = []; // 存储每个“+5”特效的状态（位置、透明度等）

// ---------------------- 新增：记录isWaving触发时间 ----------------------
let isWavingTimer = 0; // 触发后计时
const WAVE_HOLD_TIME = 500; // 触发状态保持时间（500毫秒）
// ---

// ---------------------- 新增：心情值相关变量 ----------------------
let moodValue = 0; // 当前心情值（初始0）
const moodMax = 100; // 心情值满分
const moodIncrement = 5; // 每次挥手加5分
let hasIncreasedMood = false; // 防止一次挥手重复加分
let moodEffectTimer = 0; // 心情值加分特效计时器（控制闪烁）
const moodEffectDuration = 500; // 特效持续时间（500毫秒）
// -------------------------------------------------------------------
// ---------------------- 新增：麦克风与鼓掌声检测变量 ----------------------
//let audioIn; // 麦克风音频输入对象
//let amplitude; // 音频振幅分析对象
let isClapping = false; // 鼓掌声标记（类比isWaving）
let clapTimer = 0; // 鼓掌声状态冷却时间
let CLAP_THRESHOLD = 0.2; // 鼓掌声振幅阈值（越大越灵敏，需根据环境调整）
const CLAP_HOLD_TIME = 500; // 鼓掌声状态保持时间（500毫秒，同挥手）
const CLAP_INCREMENT = 3; // 鼓掌声加心情值（+3）
// --------------------------------------
// ---------------------- 新增：麦克风状态管理 ----------------------
const MIC_STATE = {
  NOT_REQUESTED: 'not_requested', // 未请求权限
  REQUESTING: 'requesting',         // 请求中
  ACTIVE: 'active',                 // 已激活
  PERMISSION_DENIED: 'denied',      // 权限被拒绝
  ERROR: 'error'                    // 其他错误
};
let micState = MIC_STATE.NOT_REQUESTED;
let audioIn = null;
let amplitude = null;
let baseNoiseLevel = 0; // 环境噪音基准
let noiseSamples = [];  // 用于计算基准噪音
const NOISE_SAMPLE_SIZE = 50; // 采样50帧计算环境噪音
// -------------------------------------------------------------------


function setup() {
  createCanvas(windowWidth, windowHeight);
  mainCharacter = new Character(width / 2, height * 0.75 - 65, true);

  // 初始化摄像头
  video = createCapture(VIDEO);
  video.size(width, height);
  video.hide();

  // PoseNet初始化保持不变
  poseNet = ml5.poseNet(video, modelLoaded);
  poseNet.on('pose', (results) => {
    poses = results;
  });

  // 不再在setup中初始化麦克风，改为在用户点击后
  console.log("ℹ️ 麦克风将在用户首次点击后初始化");
}

function modelLoaded() {
  console.log('PoseNet模型加载完成！');
  // 此时poseNet.options已存在，可安全设置
  //poseNet.options.flipHorizontal = true; 
}


// ---------------------- 新增：UI更新函数 ----------------------
let tempMessage = "";
let tempMessageTimer = 0;

function showTemporaryMessage(msg, duration = 1500) {
  tempMessage = msg;
  tempMessageTimer = millis();
}

function updateUI() {
  // 这个函数会在draw()中调用，更新界面元素
}
// -------------------------------------------------------------------


function draw() {
  background(180, 180, 190); // 灰蒙蒙的天

  displayMicStatus();
  displayTemporaryMessage();
  // 绘制泥泞地面（位置更低）
  drawMuddyGround();
  
  // ---------------------- 新增：每帧检测鼓掌声 ----------------------
  if (micState === MIC_STATE.ACTIVE) {
    detectClap();
  }
  // -------------------------------------------------------------------
  // if (!audioIn || !amplitude) {
  //   fill(255, 0, 0);
  //   textSize(16);
  //   textAlign(CENTER);
  //   text("请允许麦克风权限并刷新页面！", width/2, height/2);
  //   return; // 权限未授权时，不执行后续逻辑
  // }
  // ---------------------- 修改：触发标志显示（统一为“互动触发”） ----------------------
  // 1. 检查是否需要隐藏标志（超过显示时长）
  if (showWaveMarker && millis() - markerTimer > MARKER_DURATION) {
    showWaveMarker = false;
  }

  // 2. 若触发互动（挥手或鼓掌），显示标志
  if (showWaveMarker) {
    fill(0, 255, 0); // 绿色文字
    textSize(20);
    textAlign(RIGHT); // 右对齐
    text("互动触发 ✔️", 150, 30); // 通用文字，不区分挥手/鼓掌
  }
  // -------------------------------------------------------------------
  
  checkWaving(); // 检测挥手动作（原有逻辑）

  // ---------------------- 核心修改：统一处理挥手和鼓掌声的反馈 ----------------------
  // 1. 定义触发类型和加分值（区分挥手/鼓掌）
  let triggerType = ""; // 存储"wave"或"clap"
  let addValue = 0;     // 存储加分值（5或3）

  // 2. 判断当前触发类型（确保不重复加分）
  if (isWaving && !hasIncreasedMood) {
    triggerType = "wave";
    addValue = moodIncrement; // 挥手+5
  } else if (isClapping && !hasIncreasedMood) {
    triggerType = "clap";
    addValue = CLAP_INCREMENT; // 鼓掌+3
  }

  // 3. 执行统一反馈逻辑（若有触发）
  if (triggerType) {
    showWaveMarker = true; // 显示互动标志
    markerTimer = millis(); // 记录标志显示时间

    // 增加心情值（不超过最大值）
    moodValue = min(moodValue + addValue, moodMax);
    moodEffectTimer = millis(); // 启动加分闪烁特效

    hasIncreasedMood = true; // 标记为已加分，防止重复

    // 控制台日志（区分触发类型）
    console.log(`心情值+${addValue}（${triggerType}），当前：${moodValue}/${moodMax}`);

    // 生成飘起的加分文字特效（+3或+5）
    floatTextEffects.push({
      x: 24, 
      y: 0, 
      alpha: 255, 
      value: `+${addValue}`
    });
  }

  // 4. 重置加分标记：两种触发都结束后才允许下次加分
  if (!isWaving && !isClapping) {
    hasIncreasedMood = false;
  }
  // -------------------------------------------------------------------
  
  // 更新并绘制主角（原有逻辑）
  mainCharacter.update(); 
  mainCharacter.display();

  // 生成路人（随机出现，原有逻辑）
  if (millis() - lastPasserbyTime > random(3000, 8000)) {
    let side = random() > 0.5 ? 'left' : 'right';
    passersby.push(new Passerby(side));
    lastPasserbyTime = millis();
  }

  // 更新和绘制所有路人（原有逻辑）
  for (let i = passersby.length - 1; i >= 0; i--) {
    passersby[i].update(); 
    passersby[i].display(); 
    if (passersby[i].isOffScreen()) { 
      passersby.splice(i, 1); 
      console.log("删除走出画面的小人，剩余数量：", passersby.length);
    }
  }

  // 主角掉泪逻辑（原有逻辑）
  tearTimer += deltaTime;
  if (tearTimer > 2000) { 
    tearDrop = true;
    tearTimer = 0;
  }

  updateUI();
}

function drawMuddyGround() {
  // 地面颜色：深褐色 + 随机斑点模拟泥泞
  fill(100, 80, 50);
  noStroke();
  rect(0, height * 0.75, width, height * 0.25); // 地面位置下调，人脚刚好踩在上面

  // 添加一些泥点纹理
  // for (let i = 0; i < 50; i++) {
  //   let x = random(width);
  //   let y = random(height * 0.75, height);
  //   let size = random(2, 8);
  //   fill(80, 60, 40);
  //   ellipse(x, y, size);
  // }
}

function checkWaving() {
  if (isWaving && millis() - isWavingTimer > WAVE_HOLD_TIME) {
    isWaving = false;
  }

  if (poses.length === 0) return;
  const pose = poses[0].pose;

  // 处理左手腕：只调用一次，避免重复添加
  if (pose.leftWrist) {
    const x = pose.leftWrist.x;
    const score = typeof pose.leftWrist.score === 'number' ? pose.leftWrist.score : 0;
    if (typeof x === 'number') {
      //console.log(`左手腕：X=${x.toFixed(0)} | 置信度=${score.toFixed(2)}`);
      trackWristMovement(x, leftWristHistory); // 仅这一次调用！
    } else {
      //console.log("左手腕：x无效，跳过");
    }
  } else {
    //console.log("左手腕：未检测到");
  }

  // 处理右手腕：保留（如果需要右手也能触发）
  if (pose.rightWrist) {
    const x = pose.rightWrist.x;
    const score = typeof pose.rightWrist.score === 'number' ? pose.rightWrist.score : 0;
    if (typeof x === 'number') {
      trackWristMovement(x, rightWristHistory);
    }
  }
}
// ---------------------- 新增：辅助函数：追踪手腕水平移动 ----------------------
function trackWristMovement(wristX, history) {
  const mirroredX = width - wristX;
  history.push(mirroredX);
  
  // 保持历史帧数不超过设定值
  if (history.length > HISTORY_LENGTH) {
    history.shift();
  }
  
  // 积累到足够帧数就计算移动距离
  if (history.length === HISTORY_LENGTH) {
    const minX = Math.min(...history);
    const maxX = Math.max(...history);
    const movement = maxX - minX;
    //console.log(`移动距离：${movement.toFixed(1)} | 阈值：${WAVE_THRESHOLD}`);
    
    if (movement > WAVE_THRESHOLD) {
      isWaving = true;
      isWavingTimer = millis();
      history.length = 0; // 触发后清空，避免重复
      console.log("🎉 检测到挥手！触发成功！");
    }
  }
}

// ---------------------- 新增：鼓掌声检测函数 ----------------------
function detectClap() {
  // ===== 1. 严格状态检查 =====
  if (micState !== MIC_STATE.ACTIVE || !amplitude || !audioIn) {
    return;
  }

  // ===== 2. 校准期间跳过检测 =====
  if (noiseSamples.length < NOISE_SAMPLE_SIZE) {
    // 仍在收集噪音样本，不进行鼓掌检测
    return;
  }

  // ===== 3. 获取当前音量 =====
  const soundLevel = amplitude.getLevel();
  
  // ===== 4. 噪音样本管理（防止内存泄漏） =====
  if (noiseSamples.length >= NOISE_SAMPLE_SIZE) {
    // 保持固定大小，移除最旧样本
    noiseSamples.shift();
  }
  noiseSamples.push(soundLevel);

  // ===== 5. 智能阈值计算 =====
  // 动态阈值 = 基础噪音 * 3（放大信号）+ 最小保护值
  const dynamicThreshold = max(baseNoiseLevel * 3, 0.15);
  // 限制在合理范围 (0.15~0.5)
  const effectiveThreshold = constrain(dynamicThreshold, 0.15, 0.5);

  // ===== 6. 鼓掌检测逻辑 =====
  const isAboveThreshold = soundLevel > effectiveThreshold;
  const isCooldownOver = (millis() - clapTimer) > CLAP_HOLD_TIME;
  
  // 检测到有效鼓掌
  if (isAboveThreshold && isCooldownOver) {
    isClapping = true;
    clapTimer = millis();
    
    console.log(`🎉 鼓掌检测! | 音量: ${soundLevel.toFixed(3)} | 阈值: ${effectiveThreshold.toFixed(3)}`);
    
    // 触发视觉反馈
    showWaveMarker = true;
    markerTimer = millis();
    
    // 播放音效反馈（可选）
    // clapSound.play();
  }

  // ===== 7. 状态衰减 =====
  if (isClapping && (millis() - clapTimer) > CLAP_HOLD_TIME) {
    isClapping = false;
  }

  // ===== 8. 调试信息（仅在开发时启用） =====
  // console.log(`[DEBUG] 音量: ${soundLevel.toFixed(3)} | 阈值: ${effectiveThreshold.toFixed(3)} | 鼓掌: ${isClapping}`);
}
// -------------------------------------------------------------------
// ---------------------- 新增：错误处理函数 ----------------------
function handleMicError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    micState = MIC_STATE.PERMISSION_DENIED;
    console.log("❌ 用户拒绝了麦克风权限");
    alert("需要麦克风权限才能检测鼓掌声。请点击页面任意位置重试授权。");
  } else {
    micState = MIC_STATE.ERROR;
    console.log("❌ 麦克风初始化错误:", error.message || error);
    alert("麦克风初始化失败: " + (error.message || "未知错误"));
  }
  updateUI();
}
// -------------------------------------------------------------------


// 小人角色类（主角）
class Character {
    constructor(x, y, isSitting = false) {
    this.x = x;
    this.y = y;
    this.isSitting = isSitting;
    this.eyeY = -5;
    this.mouthY = 10;
    this.tearCount = 0;

    // --- 抹眼泪动画相关属性 ---
    // 左臂状态管理
    this.leftArmState = "default";
    this.leftArmStartTime = 0;
    this.leftArmProgress = 0;

    // 擦眼睛时摆动相关
    this.wipeShakeStartTime = 0;
    this.wipeShakeProgress = 0;
    this.wipeShakeAngle = 0.1; // 摆动角度范围 (弧度)

    // --- 手臂运动点参数 (代数化) ---
    // 定义手臂的连接点、放下时末端、抬起时末端的坐标
    this.armJointX = 0;   // <--- 手臂与身体的连接点 X 坐标 (旋转中心)
    this.armJointY = 26;  // <--- 手臂与身体的连接点 Y 坐标 (旋转中心)
    this.armDownX = 6;    // <--- 手臂放下时（环抱）末端的 X 坐标
    this.armDownY = 17;   // <--- 手臂放下时（环抱）末端的 Y 坐标
    this.armUpX = 0;     // <--- 手臂抬起时（抹眼）末端的 X 坐标
    this.armUpY = 53;    // <--- 手臂抬起时（抹眼）末端的 Y 坐标

    // --- 根据参数自动计算状态 (无需手动修改) ---
    // 初始手臂状态 (环抱膝盖)
    this.initialLeftArmAngle = atan2(this.armDownY - this.armJointY, this.armDownX - this.armJointX);
    this.initialLeftArmLength = dist(this.armJointX, this.armJointY, this.armDownX, this.armDownY);

    // 抬起手臂状态 (抹眼睛)
    this.liftLeftArmAngle = atan2(this.armUpY - this.armJointY, this.armUpX - this.armJointX);
    this.liftLeftArmLength = dist(this.armJointX, this.armJointY, this.armUpX, this.armUpY);

    // 擦眼睛状态 (通常与抬起相同或略调整)
    this.wipeLeftArmAngle = this.liftLeftArmAngle;
    this.wipeLeftArmLength = this.liftLeftArmLength;

    // 返回手臂状态 (环抱膝盖) - 就是初始状态
    this.returnLeftArmAngle = this.initialLeftArmAngle;
    this.returnLeftArmLength = this.initialLeftArmLength;

    // 当前动画中的手臂状态 (用于 display)
    this.currentLeftArmAngle = this.initialLeftArmAngle;
    this.currentLeftArmLength = this.initialLeftArmLength;

    // 手臂与躯干的连接点坐标 (直接使用参数)
    this.leftArmBaseX = this.armJointX;
    this.leftArmBaseY = this.armJointY;
  }
  update() {
    // 表情动画：偶尔低头、抬头、抹眼泪
    if (tearDrop && this.tearCount < 3) {
      this.eyeY = -5;
      this.mouthY = 10;
      this.tearCount++;
      setTimeout(() => {
        this.eyeY = -5;
        this.mouthY = 10;
        tearDrop = false;
      }, 500);
    }

    // --- 抹眼泪动画更新逻辑 ---
    if (this.leftArmState !== "default") {
      let elapsed = millis() - this.leftArmStartTime;
      let stageDuration = 600; // 每个阶段的持续时间 (抬起, 擦, 返回)
      this.leftArmProgress = constrain(elapsed / stageDuration, 0, 1);

      if (this.leftArmState === "lifting") {
        // 从初始状态插值到抬起状态
        this.currentLeftArmAngle = lerp(this.initialLeftArmAngle, this.liftLeftArmAngle, this.leftArmProgress);
        this.currentLeftArmLength = lerp(this.initialLeftArmLength, this.liftLeftArmLength, this.leftArmProgress);

        if (this.leftArmProgress >= 1) {
          this.leftArmState = "wiping";
          this.leftArmStartTime = millis(); // 重置时间用于擦眼睛阶段
          this.wipeShakeStartTime = millis(); // 开始擦眼睛摆动计时
        }
      } else if (this.leftArmState === "wiping") {
        // 在抬起位置小幅摆动
        let shakeElapsed = millis() - this.wipeShakeStartTime;
        let shakeCycleDuration = 500; // 摆动周期
        // 使用 sin 波形在 -1 和 1 之间振荡，然后映射到摆动角度范围
        let shakeOffset = sin(map(shakeElapsed % shakeCycleDuration, 0, shakeCycleDuration, 0, TWO_PI)) * this.wipeShakeAngle;
        this.currentLeftArmAngle = this.wipeLeftArmAngle + shakeOffset;
        this.currentLeftArmLength = this.wipeLeftArmLength; // 长度可以保持不变或微调

        // 擦眼睛阶段持续一个完整的阶段时间
        if (this.leftArmProgress >= 1) {
          this.leftArmState = "returning";
          this.leftArmStartTime = millis(); // 重置时间用于返回阶段
        }
      } else if (this.leftArmState === "returning") {
        // 从当前状态（擦眼睛状态）插值到返回状态
        // 也可以从抬起状态直接返回，这里选择从擦眼睛状态返回
        this.currentLeftArmAngle = lerp(this.wipeLeftArmAngle, this.returnLeftArmAngle, this.leftArmProgress);
        this.currentLeftArmLength = lerp(this.wipeLeftArmLength, this.returnLeftArmLength, this.leftArmProgress);

        if (this.leftArmProgress >= 1) {
          this.leftArmState = "default";
          this.eyeY = -5; // 动画结束时恢复表情
          this.mouthY = 10;
          // 确保手臂状态完全回到初始值 (可选，因为lerp已经到终点)
          this.currentLeftArmAngle = this.initialLeftArmAngle;
          this.currentLeftArmLength = this.initialLeftArmLength;
        }
      }
    }
  }

  display() {
    push();
    translate(this.x, this.y);

    stroke(0);
    strokeWeight(2);
    noFill();

    // 头部（圆形）
    ellipse(0, 0, 30, 30);
    
    // ---------------------- 新增：绘制心情值竖长方形 ----------------------
// 1. 心情值方框位置：主角头部右侧15px（不遮挡），上下居中
    const moodBoxX = 20; // 距离头部中心右侧20px（头半径15，留5px间距）
    const moodBoxY = -15; // 方框顶部对齐头部中心上方15px
    const moodBoxWidth = 8; // 方框宽度
    const moodBoxHeight = 30; // 方框高度（满分时填满）

    // 2. 绘制空心方框边框（黑色）
    stroke(0);
    strokeWeight(1);
    noFill();
    rect(moodBoxX, moodBoxY, moodBoxWidth, moodBoxHeight); // 竖长方形

    // 3. 计算绿色填充高度（按心情值比例：moodValue/moodMax * 总高度）
    const fillHeight = (moodValue / moodMax) * moodBoxHeight;
    // 填充位置：从方框底部往上填（符合“逐渐填满”的视觉）
    const fillY = moodBoxY + moodBoxHeight - fillHeight; // 填充顶部Y坐标

    // 4. 加分特效：判断是否在特效时长内，决定填充色（亮绿→正常绿）
    let fillColor = color(46, 125, 50); // 正常绿色（#2E7D32）
    if (millis() - moodEffectTimer < moodEffectDuration) {
      fillColor = color(76, 175, 80); // 亮绿色（#4CAF50），加分时闪烁
    }

    // 5. 绘制绿色填充（心情值进度）
    fill(fillColor);
    noStroke();
    if (fillHeight > 0) { // 有心情值才画填充
      rect(moodBoxX, fillY, moodBoxWidth, fillHeight);
    }
    // -------------------------------------------------------------------
    stroke(0); // 恢复黑色边框
    strokeWeight(2); // 恢复边框粗细（与头部绘制一致
    
    // ---------------------- 新增1：绘制“5/100”量化文字（方框正下方） ----------------------
    const quantText = `${moodValue}/${moodMax}`;
    const quantTextSize = 8;
    textSize(quantTextSize);
    fill(0); // 黑色文字
    noStroke();
    // 关键：设置文字水平居中、垂直顶对齐（确保位置精准）
    textAlign(CENTER, TOP); 
    // 文字X：方框水平中心（moodBoxX + 方框宽/2），永远对齐方框中心
    const quantTextX = moodBoxX + moodBoxWidth / 2; 
    // 文字Y：方框底部+2px（贴紧底部，不悬空，固定不变）
    const quantTextY = moodBoxY + moodBoxHeight + 2; 
    text(quantText, quantTextX, quantTextY);
    // -------------------------------------------------------------------

    // ---------------------- 新增2：绘制“+5”飘起特效并更新状态 ----------------------
    fill(46, 125, 50); // “+5”文字颜色（与心情值填充色一致）
    noStroke();
    textSize(10); // “+5”字号
    // 遍历所有特效，更新并绘制
    for (let i = floatTextEffects.length - 1; i >= 0; i--) {
      const effect = floatTextEffects[i];
      // 1. 更新特效状态：上飘（Y-2）、渐隐（alpha-5）
      effect.y -= 2; // 每帧上移2px，速度适中
      effect.alpha -= 5; // 每帧透明度降低5，渐隐效果自然

      // 2. 绘制“+5”文字（根据当前透明度）
      fill(46, 125, 50, effect.alpha); // 带透明度的绿色
      text(effect.value, effect.x, effect.y);

      // 3. 移除透明度<0的特效（避免内存占用）
      if (effect.alpha < 0) {
        floatTextEffects.splice(i, 1);
      }
    }
    // -------------------------------------------------------------------

    // ---------------------- 恢复stroke状态（确保后续躯干/手臂正常绘制） ----------------------
    stroke(0);
    strokeWeight(2);

    
    // 画两只眼睛
    fill(0);
    ellipse(-5, this.eyeY, 2, 2); // 左眼
    ellipse(5, this.eyeY, 2, 2);  // 右眼

    // 悲伤嘴巴：向下弯的弧线（贴住脸边缘，只画右半边）
    noFill();
    arc(0, this.mouthY, 15, 8, PI*10/9, -PI/9); // 从左到右画半圆，只显示右半部分

    // 身体：拉长躯干
    line(0, 15, 0, 45); // 躯干向下拉长

    // 腿部：倒V型（大腿+小腿）
    line(0, 45, -6, 65); // 左腿
    line(0, 45, 6, 65);  // 右腿

    // 左手臂：根据动画状态绘制
    push();
    translate(this.leftArmBaseX, this.leftArmBaseY);
    rotate(this.currentLeftArmAngle);
    line(0, 0, -this.currentLeftArmLength, 0); // 画一条线作为手臂
    pop();

    // 右手臂：始终绘制为默认状态 (环抱膝盖)
    line(0, 25, 7, 35);

    // 掉眼泪动画（从眼睛下方滴落）
    if (tearDrop && this.tearCount > 0) {
      fill(200, 220, 255, 180);
      // 两只眼睛都可能掉泪
      ellipse(-5.5, this.eyeY + 6, 4, 6); // 左眼泪
      ellipse(5.5, this.eyeY + 6, 4, 6);  // 右眼泪
    }

    pop();
  }

  // 抹眼泪动作 (启动动画)
  wipeTears() {
    // 只有在默认状态下才能启动动画
    if (this.leftArmState === "default") {
      // 设置动画开始
      this.leftArmState = "lifting";
      this.leftArmStartTime = millis();
      this.leftArmProgress = 0;
      // 动画过程中可以改变表情
      this.eyeY = -4;
      this.mouthY = 9;
    }
  }
}

// 路人角色类（带统一慢速行走动画 + 正确侧脸 + V字形手足）
class Passerby {
  constructor(side) {
    this.side = side;
    this.x = side === 'left' ? -50 : width + 50;
    this.y = height * 0.75 - 65; // 脚底对齐地面线
    this.speed = WALK_SPEED; // 统一慢速
    this.hasInteracted = false;
    this.interactionTimer = 0;
    this.walkFrame = 0; // 行走动画帧
    this.message = "";
  }

  update() {
    if (this.side === 'left') {
      this.x += this.speed;
    } else {
      this.x -= this.speed;
    }

    // 行走动画（统一慢速）
    this.walkFrame += WALK_FRAME_SPEED;
    if (this.walkFrame > 2) this.walkFrame = 0;

    // 当走到主角附近时互动
    if (!this.hasInteracted && abs(this.x - mainCharacter.x) < 50) {
      this.hasInteracted = true;
      this.interactionTimer = millis();

      // 拍拍肩膀 + 说句话
      setTimeout(() => {
        mainCharacter.wipeTears(); // 主角抹眼泪
      }, 200);

      setTimeout(() => {
        this.message = " ";
      }, 500);
    }

    // 清除消息
    if (this.hasInteracted && millis() - this.interactionTimer > 3000) {
      this.message = "";
    }
  }

  display() {
    push();
    translate(this.x, this.y);

    stroke(0);
    strokeWeight(2);
    noFill();

    // 头部
    ellipse(0, 0, 30, 30);

    // 侧脸：根据方向画不同的眼睛和嘴巴
    if (this.side === 'left') {
      // 从左往右走 → 面向右 → 画**右眼**（观众视角右边，即头的右侧）
      fill(0);
      ellipse(5, -5, 2, 2); // 右眼（观众视角右边）

      // 笑脸：向上弯的弧线（贴住脸边缘，只画右半边）
      noFill();
      arc(11, 5, 19, 8, PI/2, PI); // 从左到右画半圆，只显示右半部分
    } else {
      // 从右往左走 → 面向左 → 画**左眼**（观众视角左边，即头的左侧）
      fill(0);
      ellipse(-5, -5, 2, 2); // 左眼（观众视角左边）

      // 笑脸：向上弯的弧线（贴住脸边缘，只画左半边）
      noFill();
      arc(-11, 5, 19, 8, 0, PI/2); // 从右到左画半圆，只显示左半部分
    }

    // 躯干（拉长）
    line(0, 15, 0, 45);

    // 腿部行走动画（V字形，统一慢速，与手臂相位相反）
    let legPhase = sin(this.walkFrame * PI);
    // 将正弦波转换为V字形：绝对值后映射到 -1 到 1
    let legOffset = map(abs(legPhase), 0, 1, 0, 1) * 5 * (legPhase > 0 ? 1 : -1);
    line(0, 45, -5 + legOffset, 65); // 左腿
    line(0, 45, 5 - legOffset, 65);  // 右腿

    // 手臂摆动动画（V字形，统一慢速，与腿部相位相反，形成交叉）
    let armPhase = cos(this.walkFrame * PI + PI*1.44);
    // 将余弦波转换为V字形：绝对值后映射到 -1 到 1
    let armOffset = map(abs(armPhase), 0, 1, 0, 1) * 5 * (armPhase > 0 ? 1 : -1);
    line(0, 25, -4.5 + armOffset, 35); // 左臂
    line(0, 25, 4.5 - armOffset, 35);  // 右臂

    // 显示安慰语句（如果存在）
    if (this.message) {
      fill(255);
      textAlign(CENTER, CENTER);
      textSize(12);
      text(this.message, 0, -40);
    }

    pop();
  }

  isOffScreen() {
    // 左侧出现的小人：当x > 画布宽度 + 自身宽度（确保完全离开右侧）
    if (this.side === 'left') {
      return this.x > width + 30; // 30是小人头部宽度，确保完全离开
    } 
    // 右侧出现的小人：当x < -自身宽度（确保完全离开左侧）
    else {
      return this.x < -30; // 30是小人头部宽度，确保完全离开
    }
  }
}

// ---------------------- 重构：麦克风初始化函数 ----------------------
function initMicrophone() {
  if (micState !== MIC_STATE.NOT_REQUESTED) return;
  
  micState = MIC_STATE.REQUESTING;
  showTemporaryMessage("⏳ 请允许麦克风权限...", 3000);
  
  try {
    // 创建新实例
    audioIn = new p5.AudioIn();
    audioIn.onError = handleMicError;
    
    audioIn.start(() => {
      amplitude = new p5.Amplitude();
      amplitude.setInput(audioIn);
      micState = MIC_STATE.ACTIVE;
      startNoiseCalibration();
      showTemporaryMessage("✅ 麦克风已激活", 1500);
    });
  } catch (err) {
    handleMicError(err);
  }
}
// -------------------------------------------------------------------
function keyPressed() {
  // 空格键模拟鼓掌 (32 = space)
  if (key === ' ' && micState === MIC_STATE.ACTIVE) {
    triggerClap();
    return false; // 阻止页面滚动
  }
}
function triggerClap() {
  isClapping = true;
  clapTimer = millis();
  console.log("⌨️ 空格键模拟鼓掌");
}
// ---------------------- 新增：噪音校准函数 ----------------------
function startNoiseCalibration() {
  noiseSamples = [];
  console.log("🔊 校准环境噪音中 (5秒)...");
  
  setTimeout(() => {
    if (noiseSamples.length === 0) {
      CLAP_THRESHOLD = 0.25; // 失败时安全值
      return;
    }
    
    // 科学计算阈值
    const avgNoise = noiseSamples.reduce((a, b) => a + b) / noiseSamples.length;
    baseNoiseLevel = avgNoise;
    CLAP_THRESHOLD = constrain(avgNoise * 3, 0.15, 0.5);
    
    console.log(`✅ 校准完成 | 噪音: ${avgNoise.toFixed(3)} | 阈值: ${CLAP_THRESHOLD.toFixed(3)}`);
    showTemporaryMessage("🎤 校准完成! 试试鼓掌吧", 2000);
  }, 5000);
}
// -------------------------------------------------------------------

// ---------------------- 重构：鼠标点击事件 ----------------------
function mousePressed() {
  // 首次点击：初始化麦克风
  if (micState === MIC_STATE.NOT_REQUESTED) {
    initMicrophone();
    // 显示临时提示
    showTemporaryMessage("正在请求麦克风权限...", 2000);
    return;
  }
  
  // 权限被拒绝后重试
  if (micState === MIC_STATE.PERMISSION_DENIED) {
    // 由于浏览器限制，无法直接重试，需要提示用户手动刷新
    alert("请刷新页面并允许麦克风权限");
    return;
  }
  
  // 备用交互：按空格键模拟鼓掌
  if (keyIsDown(32)) { // 32是空格键
    isClapping = true;
    clapTimer = millis();
    console.log("⌨️ 空格键模拟鼓掌");
    return;
  }
  
  // 点击任意位置触发表情变化（测试用）
  if (micState === MIC_STATE.ACTIVE) {
    mainCharacter.wipeTears();
    showTemporaryMessage("手动触发抹眼泪", 1000);
  }
}
// -------------------------------------------------------------------

// ---------------------- 新增：显示麦克风状态 ----------------------
function displayMicStatus() {
  let statusText = "";
  let statusColor = color(100); // 灰色
  
  switch(micState) {
    case MIC_STATE.NOT_REQUESTED:
      statusText = "ⓘ 点击页面启用鼓掌互动";
      statusColor = color(100, 150, 200); // 蓝色
      break;
    case MIC_STATE.REQUESTING:
      statusText = "⏳ 请求麦克风权限中...";
      statusColor = color(200, 150, 50); // 橙色
      break;
    case MIC_STATE.ACTIVE:
      statusText = "🎤 麦克风已激活";
      statusColor = color(50, 180, 50); // 绿色
      break;
    case MIC_STATE.PERMISSION_DENIED:
      statusText = "🔇 麦克风权限被拒绝";
      statusColor = color(200, 50, 50); // 红色
      break;
    case MIC_STATE.ERROR:
      statusText = "❌ 麦克风错误";
      statusColor = color(200, 50, 50); // 红色
      break;
  }
  
  fill(statusColor);
  textSize(14);
  textAlign(LEFT, TOP);
  text(statusText, 20, 20);
  
  // 显示当前音量级别（仅在激活状态）
  if (micState === MIC_STATE.ACTIVE && amplitude) {
    const level = amplitude.getLevel();
    const barWidth = map(level, 0, 1, 0, 100);
    
    // 音量条背景
    fill(200);
    rect(20, 40, 100, 10);
    
    // 音量条前景
    fill(50, 180, 50);
    rect(20, 40, barWidth, 10);
    
    // 阈值标记
    fill(200, 50, 50);
    line(20 + map(CLAP_THRESHOLD, 0, 1, 0, 100), 38, 20 + map(CLAP_THRESHOLD, 0, 1, 0, 100), 52);
  }
}
// ---------------------------------------------------------------

// ---------------------- 新增：显示临时消息 ----------------------
function displayTemporaryMessage() {
  if (tempMessage && millis() - tempMessageTimer < 2000) {
    fill(50, 50, 50, 200);
    rect(0, height/2 - 20, width, 40);
    
    fill(255);
    textSize(18);
    textAlign(CENTER, CENTER);
    text(tempMessage, width/2, height/2);
  } else if (tempMessage) {
    tempMessage = ""; // 清除过期消息
  }
}
// -------------------------------------------------------------------

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}



display() {
    push();
    translate(this.x, this.y);

    stroke(0);
    strokeWeight(2);
    noFill();

    // 头部（圆形）
    ellipse(0, 0, 30, 30);
    
    // ---------------------- 绘制心情值竖长方形 ----------------------
    const moodBoxX = 20; 
    const moodBoxY = -15; 
    const moodBoxWidth = 8; 
    const moodBoxHeight = 30; 

    // 绘制空心方框边框（黑色）
    stroke(0);
    strokeWeight(1);
    noFill();
    rect(moodBoxX, moodBoxY, moodBoxWidth, moodBoxHeight);

    // 计算绿色填充高度
    const fillHeight = (moodValue / moodMax) * moodBoxHeight;
    const fillY = moodBoxY + moodBoxHeight - fillHeight; 

    // 加分特效：判断是否在特效时长内
    let fillColor = color(46, 125, 50); // 正常绿色
    if (millis() - moodEffectTimer < moodEffectDuration) {
      fillColor = color(76, 175, 80); // 亮绿色
    }

    // 绘制绿色填充
    fill(fillColor);
    noStroke();
    if (fillHeight > 0) {
      rect(moodBoxX, fillY, moodBoxWidth, fillHeight);
    }
    stroke(0); 
    strokeWeight(2); 
    
    // ---------------------- 绘制"5/100"量化文字 ----------------------
    const quantText = `${moodValue}/${moodMax}`;
    const quantTextSize = 8;
    textSize(quantTextSize);
    fill(0); 
    noStroke();
    textAlign(CENTER, TOP); 
    const quantTextX = moodBoxX + moodBoxWidth / 2; 
    const quantTextY = moodBoxY + moodBoxHeight + 2; 
    text(quantText, quantTextX, quantTextY);

    // ---------------------- 绘制"+5"飘起特效 ----------------------
    for (let i = floatTextEffects.length - 1; i >= 0; i--) {
      const effect = floatTextEffects[i];
      
      // 更新特效状态：上飘、渐隐
      effect.y -= 1.5; // 适中上移速度
      effect.alpha -= 4; // 适中渐隐速度

      // 绘制文字
      fill(46, 125, 50, effect.alpha);
      textSize(12);
      textAlign(CENTER, CENTER);
      text(effect.value, effect.x - this.x, effect.y - this.y);

      // 移除透明度<0的特效
      if (effect.alpha < 0) {
        floatTextEffects.splice(i, 1);
      }
    }

    // 画两只眼睛
    fill(0);
    ellipse(-5, this.eyeY, 2, 2); // 左眼
    ellipse(5, this.eyeY, 2, 2);  // 右眼

    // 悲伤嘴巴
    noFill();
    arc(0, this.mouthY, 15, 8, PI*10/9, -PI/9);

    // 身体：拉长躯干
    line(0, 15, 0, 45);

    // 腿部
    line(0, 45, -6, 65); // 左腿
    line(0, 45, 6, 65);  // 右腿

    // 左手臂
    push();
    translate(this.leftArmBaseX, this.leftArmBaseY);
    rotate(this.currentLeftArmAngle);
    line(0, 0, -this.currentLeftArmLength, 0);
    pop();

    // 右手臂
    line(0, 25, 7, 35);

    // 掉眼泪动画
    if (tearDrop && this.tearCount > 0) {
      fill(200, 220, 255, 180);
      ellipse(-5.5, this.eyeY + 6, 4, 6); // 左眼泪
      ellipse(5.5, this.eyeY + 6, 4, 6);  // 右眼泪
    }

    pop();
  }