let mainCharacter;
let passersby = [];
let tearTimer = 0;
let tearDrop = false;
let lastPasserbyTime = 0;

let video; // 摄像头视频流对象
let poseNet; // PoseNet 姿态检测模型
let poses = []; // 存储检测到的人体姿态数据
let isWaving = false; // 挥手动作标记

let leftWristHistory = []; 
let rightWristHistory = [];
const HISTORY_LENGTH = 10;
const WAVE_THRESHOLD = 500; // 挥手判定阈值

// 全局统一的慢速
const WALK_SPEED = 1;
const WALK_FRAME_SPEED = 0.05;

let showWaveMarker = false;
let markerTimer = 0;
const MARKER_DURATION = 1500;

let floatTextEffects = [];

let isWavingTimer = 0;
const WAVE_HOLD_TIME = 500;

// 心情值相关变量
let moodValue = 0;
const moodMax = 100;
const moodIncrement = 5;
let hasIncreasedMood = false;
let moodEffectTimer = 0;
const moodEffectDuration = 500;

// 麦克风与鼓掌声检测变量 - 重写这部分
let isClapping = false;
let clapTimer = 0;
let CLAP_THRESHOLD = 0.2;
const CLAP_HOLD_TIME = 500;
const CLAP_INCREMENT = 3;

// 麦克风状态管理 - 增强版
const MIC_STATE = {
  NOT_REQUESTED: 'not_requested',
  REQUESTING: 'requesting',
  CALIBRATING: 'calibrating',
  ACTIVE: 'active',
  PERMISSION_DENIED: 'denied',
  ERROR: 'error'
};
let micState = MIC_STATE.NOT_REQUESTED;
let audioContext = null; // 音频上下文
let audioStream = null; // 音频流
let analyser = null; // Web Audio API分析器
let microphone = null; // 麦克风源
let dataArray = null; // 音频数据数组
let baseNoiseLevel = 0;
let noiseSamples = [];
const NOISE_SAMPLE_SIZE = 50;
let volumeLevel = 0; // 当前音量级别，便于调试

// 首次用户交互标记
let userInteracted = false;

function setup() {
  createCanvas(windowWidth, windowHeight);
  
  // 检查是否为安全上下文
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    showTemporaryMessage("⚠️ 麦克风需要HTTPS或localhost环境", 8000);
    console.warn("麦克风API仅在安全上下文中可用(HTTPS或localhost)");
  }
  
  mainCharacter = new Character(width / 2, height * 0.75 - 65, true);

  // 初始化摄像头
  video = createCapture(VIDEO);
  video.size(width, height);
  video.hide();
  video.elt.muted = true; // 确保视频元素静音

  // PoseNet初始化
  poseNet = ml5.poseNet(video, modelLoaded);
  poseNet.on('pose', (results) => {
    poses = results;
  });

  console.log("ℹ️ 等待用户点击以激活音频...");
  
  // 为触摸设备添加额外的交互监听
  document.addEventListener('touchstart', handleFirstInteraction);
  document.addEventListener('mousedown', handleFirstInteraction);
}

function handleFirstInteraction() {
  if (userInteracted) return;
  userInteracted = true;
  
  // 尝试恢复音频上下文
  if (typeof getAudioContext === 'function') {
    getAudioContext().resume().catch(e => {
      console.log("音频上下文恢复错误:", e);
    });
  }
  
  // 移除监听器
  document.removeEventListener('touchstart', handleFirstInteraction);
  document.removeEventListener('mousedown', handleFirstInteraction);
}

function modelLoaded() {
  console.log('PoseNet模型加载完成！');
}

let tempMessage = "";
let tempMessageTimer = 0;

function showTemporaryMessage(msg, duration = 1500) {
  tempMessage = msg;
  tempMessageTimer = millis();
}

function draw() {
  background(180, 180, 190);
  
  // 显示状态信息（始终显示）
  displayMicStatus();
  displayTemporaryMessage();
  
  drawMuddyGround();
  
  // 仅当麦克风已激活时检测鼓掌
  if (micState === MIC_STATE.ACTIVE || micState === MIC_STATE.CALIBRATING) {
    detectClap();
  }
  
  // 处理互动标志
  if (showWaveMarker && millis() - markerTimer > MARKER_DURATION) {
    showWaveMarker = false;
  }

  if (showWaveMarker) {
    fill(0, 255, 0);
    textSize(20);
    textAlign(RIGHT);
    //text("互动触发 ✔️", 150, 30);
  }
  
  // 检测挥手
  checkWaving();

  // 处理互动反馈
  let triggerType = "";
  let addValue = 0;

  if (!hasIncreasedMood) {
    if (isWaving && (!isClapping || isWavingTimer > clapTimer)) {
      triggerType = "wave";
      addValue = moodIncrement;
    } else if (isClapping) {
      triggerType = "clap";
      addValue = CLAP_INCREMENT;
    }
  }

  if (triggerType) {
    showWaveMarker = true;
    markerTimer = millis();

    moodValue = min(moodValue + addValue, moodMax);
    moodEffectTimer = millis();
    hasIncreasedMood = true;

    console.log(`心情值+${addValue}（${triggerType}），当前：${moodValue}/${moodMax}`);

    floatTextEffects.push({
      x: mainCharacter.x + 36, 
      y: mainCharacter.y , 
      alpha: 255, 
      value: `+${addValue}`,
      horizontalOffset: 0,
      horizontalPhase: random(TWO_PI), // 随机起始相位
      horizontalAmplitude: random(3, 7), // 随机幅度(3-7像素)
      horizontalFrequency: 0.03 + random(0.02) // 随机频率
    });
  }

  if (!isWaving && !isClapping) {
    hasIncreasedMood = false;
  }
  
  // 更新和绘制角色
  mainCharacter.update(); 
  mainCharacter.display();

  // 生成路人
  if (millis() - lastPasserbyTime > random(3000, 8000)) {
    let side = random() > 0.5 ? 'left' : 'right';
    passersby.push(new Passerby(side));
    lastPasserbyTime = millis();
  }

  // 更新和绘制路人
  for (let i = passersby.length - 1; i >= 0; i--) {
    passersby[i].update(); 
    passersby[i].display(); 
    if (passersby[i].isOffScreen()) { 
      passersby.splice(i, 1);
    }
  }

  // 掉泪逻辑（情绪低落时）
  tearTimer += deltaTime;
  if (tearTimer > 2000 && !isWaving && !isClapping && moodValue < 80) { 
    tearDrop = true;
    tearTimer = 0;
  }
}

function drawMuddyGround() {
  fill(100, 80, 50);
  noStroke();
  rect(0, height * 0.75, width, height * 0.25);
}

function checkWaving() {
  if (isWaving && millis() - isWavingTimer > WAVE_HOLD_TIME) {
    isWaving = false;
  }

  if (poses.length === 0) return;
  const pose = poses[0].pose;

  if (pose.leftWrist) {
    const x = pose.leftWrist.x;
    if (typeof x === 'number') {
      trackWristMovement(x, leftWristHistory);
    }
  }

  if (pose.rightWrist) {
    const x = pose.rightWrist.x;
    if (typeof x === 'number') {
      trackWristMovement(x, rightWristHistory);
    }
  }
}

function trackWristMovement(wristX, history) {
  const mirroredX = width - wristX;
  history.push(mirroredX);
  
  if (history.length > HISTORY_LENGTH) {
    history.shift();
  }
  
  if (history.length === HISTORY_LENGTH) {
    let minX = history[0];
    let maxX = history[0];
    for (let i = 1; i < history.length; i++) {
      if (history[i] < minX) minX = history[i];
      if (history[i] > maxX) maxX = history[i];
    }
    const movement = maxX - minX;
    
    if (movement > WAVE_THRESHOLD) {
      isWaving = true;
      isWavingTimer = millis();
      history.length = 0;
      console.log("🎉 检测到挥手！触发成功！");
      console.log(movement,' ',maxX,' ',minX)
    }
    
  }
}

// ---------------------- 麦克风检测核心修复 ----------------------
function detectClap() {
  if (!analyser || !dataArray) return;
  
  // 使用Web Audio API获取实时音量
  analyser.getByteTimeDomainData(dataArray);
  
  // 计算RMS（均方根）音量
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const value = (dataArray[i] - 128) / 128; // 归一化到[-1, 1]
    sum += value * value;
  }
  const rms = Math.sqrt(sum / dataArray.length);
  volumeLevel = rms; // 保存当前音量，用于UI显示
  
  // 校准阶段
  if (micState === MIC_STATE.CALIBRATING) {
    noiseSamples.push(rms);
    
    if (noiseSamples.length >= NOISE_SAMPLE_SIZE) {
      completeCalibration();
    }
    return;
  }
  
  // 活动阶段
  if (micState === MIC_STATE.ACTIVE && noiseSamples.length >= NOISE_SAMPLE_SIZE) {
    const dynamicThreshold = max(baseNoiseLevel * 3, 0.15);
    const effectiveThreshold = constrain(dynamicThreshold, 0.15, 0.5);
    
    const isAboveThreshold = rms > effectiveThreshold;
    const isCooldownOver = (millis() - clapTimer) > CLAP_HOLD_TIME;
    
    if (isAboveThreshold && isCooldownOver) {
      isClapping = true;
      clapTimer = millis();
      
      console.log(`🎉 鼓掌检测! | 音量: ${rms.toFixed(3)} | 阈值: ${effectiveThreshold.toFixed(3)}`);
      showWaveMarker = true;
      markerTimer = millis();
    }

    if (isClapping && (millis() - clapTimer) > CLAP_HOLD_TIME) {
      isClapping = false;
    }
  }
}

function completeCalibration() {
  const avgNoise = noiseSamples.reduce((a, b) => a + b, 0) / noiseSamples.length;
  baseNoiseLevel = avgNoise;
  CLAP_THRESHOLD = constrain(avgNoise * 3, 0.15, 0.5);
  
  console.log(`✅ 校准完成 | 噪音: ${avgNoise.toFixed(3)} | 阈值: ${CLAP_THRESHOLD.toFixed(3)}`);
  showTemporaryMessage("🎤 校准完成！试试鼓掌或挥手互动吧", 3000);
  
  micState = MIC_STATE.ACTIVE;
}

// ---------------------- 麦克风初始化 - 完全重写 ----------------------
function initMicrophone() {
  if (micState !== MIC_STATE.NOT_REQUESTED) return;
  
  micState = MIC_STATE.REQUESTING;
  showTemporaryMessage("⏳ 请求麦克风权限...", 3000);
  
  // 确保用户已交互
  if (!userInteracted) {
    showTemporaryMessage("⚠️ 请点击页面任意位置激活音频", 3000);
    return;
  }
  
  // 使用现代Web Audio API直接获取麦克风
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      // 保存音频流
      audioStream = stream;
      
      // 创建或获取音频上下文
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // 恢复音频上下文（某些浏览器需要）
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      // 创建分析节点
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      
      // 创建麦克风源
      microphone = audioContext.createMediaStreamSource(stream);
      
      // 连接节点
      microphone.connect(analyser);
      
      // 创建数据数组
      dataArray = new Uint8Array(analyser.fftSize);
      
      // 开始校准
      micState = MIC_STATE.CALIBRATING;
      noiseSamples = [];
      showTemporaryMessage("🔊 请保持安静，正在校准环境噪音...", 5000);
      
      console.log("✅ 麦克风成功连接");
    })
    .catch(error => {
      console.error("❌ 麦克风访问错误:", error);
      handleMicError(error);
    });
}

function handleMicError(error) {
  // 停止任何现有流
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }
  
  // 关闭音频上下文
  if (audioContext) {
    audioContext.close().catch(e => console.log("关闭音频上下文错误:", e));
    audioContext = null;
  }
  
  analyser = null;
  microphone = null;
  dataArray = null;
  
  // 设置错误状态
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    micState = MIC_STATE.PERMISSION_DENIED;
    showTemporaryMessage("❌ 请允许麦克风权限才能检测鼓掌声", 5000);
  } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    micState = MIC_STATE.ERROR;
    showTemporaryMessage("❌ 未找到麦克风设备", 5000);
  } else {
    micState = MIC_STATE.ERROR;
    showTemporaryMessage(`❌ 麦克风错误: ${error.message || '未知错误'}`, 5000);
  }
  
  console.error("麦克风错误详情:", error);
}

// ---------------------- 事件处理 ----------------------
function keyPressed() {
  if (key === ' ') {
    // 空格键模拟鼓掌
    simulateClap();
    return false;
  }
  
  if (key === 'r' || key === 'R') {
    // 重置心情值
    moodValue = 0;
    showTemporaryMessage("心情值已重置", 1000);
    return false;
  }
  
  if (key === 'm' || key === 'M') {
    // 重新初始化麦克风
    micState = MIC_STATE.NOT_REQUESTED;
    initMicrophone();
    return false;
  }
}

function simulateClap() {
  if (micState !== MIC_STATE.ACTIVE) return;
  
  isClapping = true;
  clapTimer = millis();
  console.log("⌨️ 空格键模拟鼓掌");
  showWaveMarker = true;
  markerTimer = millis();
}

function mousePressed() {
  // 首次交互
  if (!userInteracted) {
    userInteracted = true;
    
    // 尝试恢复音频上下文
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }
  
  // 初始化麦克风
  if (micState === MIC_STATE.NOT_REQUESTED) {
    initMicrophone();
    return;
  }
  
  // 重新请求权限
  if (micState === MIC_STATE.PERMISSION_DENIED) {
    showTemporaryMessage("请刷新页面并允许麦克风权限", 3000);
    return;
  }
  
  // 点击安慰小人
  if (micState === MIC_STATE.ACTIVE || micState === MIC_STATE.CALIBRATING) {
    if (moodValue < 100) {
      mainCharacter.wipeTears();
      showTemporaryMessage("你安慰了小人", 1000);
      
      // 增加心情值
      moodValue = min(moodValue + 2, moodMax);
      moodEffectTimer = millis();
      
      floatTextEffects.push({
        x: mainCharacter.x + 24, 
        y: mainCharacter.y - 15, 
        alpha: 255, 
        value: "+2"
      });
    } else {
      showTemporaryMessage("小人现在心情不错！", 1000);
    }
  }
}

// ---------------------- UI 显示 ----------------------
function displayMicStatus() {
  let statusText = "";
  let statusColor = color(100);
  
  switch(micState) {
    case MIC_STATE.NOT_REQUESTED:
      statusText = "ⓘ 点击页面启用鼓掌互动";
      statusColor = color(100, 150, 200);
      break;
    case MIC_STATE.REQUESTING:
      statusText = "⏳ 请求麦克风权限中...";
      statusColor = color(200, 150, 50);
      break;
    case MIC_STATE.CALIBRATING:
      statusText = `🔊 校准环境噪音中... (${noiseSamples.length}/${NOISE_SAMPLE_SIZE})`;
      statusColor = color(200, 180, 50);
      break;
    case MIC_STATE.ACTIVE:
      statusText = "🎤 麦克风已激活";
      statusColor = color(50, 180, 50);
      break;
    case MIC_STATE.PERMISSION_DENIED:
      statusText = "🔇 麦克风权限被拒绝";
      statusColor = color(200, 50, 50);
      break;
    case MIC_STATE.ERROR:
      statusText = "❌ 麦克风错误";
      statusColor = color(200, 50, 50);
      break;
  }
  
  fill(statusColor);
  textSize(14);
  textAlign(LEFT, TOP);
  text(statusText, 20, 20);
  
  // 音量显示 - 使用直接获取的音量级别
  if (micState === MIC_STATE.ACTIVE || micState === MIC_STATE.CALIBRATING) {
    const barWidth = map(volumeLevel, 0, 1, 0, 100);
    
    // 计算显示阈值
    let displayThreshold = 0.2;
    if (micState === MIC_STATE.ACTIVE && noiseSamples.length >= NOISE_SAMPLE_SIZE) {
      displayThreshold = constrain(baseNoiseLevel * 3, 0.15, 0.5);
    }
    
    // 音量条背景
    fill(220);
    stroke(150);
    strokeWeight(1);
    rect(20, 40, 100, 10);
    
    // 音量条前景
    fill(50, 180, 50);
    noStroke();
    rect(20, 40, barWidth, 10);
    
    // 阈值标记
    fill(200, 50, 50);
    strokeWeight(1.5);
    line(20 + map(displayThreshold, 0, 1, 0, 100), 35, 20 + map(displayThreshold, 0, 1, 0, 100), 50);
    
    // 显示当前音量
    fill(50);
    textSize(10);
    textAlign(LEFT, TOP);
    text(`音量: ${volumeLevel.toFixed(3)}`, 125, 40);
  }
}

function displayTemporaryMessage() {
  if (!tempMessage || millis() - tempMessageTimer > 2000) {
    tempMessage = "";
    return;
  }
  
  fill(50, 50, 50, 220);
  noStroke();
  rect(0, 10, width, 30);
  
  fill(255);
  textSize(16);
  textAlign(CENTER, CENTER);
  text(tempMessage, width/2, 25);
}

// ---------------------- 角色和路人代码（保持不变） ----------------------
// 这里保持您原有的 Character 和 Passerby 类代码不变
// 为简洁起见，我没有在这里重复它们，但请保留您的原始实现

class Character {
  // 保留您原有的Character类实现
  constructor(x, y, isSitting = false) {
    this.x = x;
    this.y = y;
    this.isSitting = isSitting;
    this.eyeY = -5;
    this.mouthY = 10;
    this.tearCount = 0;

    // --- 抹眼泪动画相关属性 ---
    this.leftArmState = "default";
    this.leftArmStartTime = 0;
    this.leftArmProgress = 0;

    this.wipeShakeStartTime = 0;
    this.wipeShakeAngle = 0.1; // 摆动角度范围 (弧度)

    // --- 手臂运动点参数 ---
    this.armJointX = 0;   // 手臂与身体的连接点 X 坐标
    this.armJointY = 26;  // 手臂与身体的连接点 Y 坐标
    this.armDownX = 6;    // 手臂放下时末端的 X 坐标
    this.armDownY = 17;   // 手臂放下时末端的 Y 坐标
    this.armUpX = 0;      // 手臂抬起时末端的 X 坐标
    this.armUpY = 53;     // 手臂抬起时末端的 Y 坐标

    // --- 计算手臂状态 ---
    this.initialLeftArmAngle = atan2(this.armDownY - this.armJointY, this.armDownX - this.armJointX);
    this.initialLeftArmLength = dist(this.armJointX, this.armJointY, this.armDownX, this.armDownY);

    this.liftLeftArmAngle = atan2(this.armUpY - this.armJointY, this.armUpX - this.armJointX);
    this.liftLeftArmLength = dist(this.armJointX, this.armJointY, this.armUpX, this.armUpY);

    this.wipeLeftArmAngle = this.liftLeftArmAngle;
    this.wipeLeftArmLength = this.liftLeftArmLength;

    this.returnLeftArmAngle = this.initialLeftArmAngle;
    this.returnLeftArmLength = this.initialLeftArmLength;

    this.currentLeftArmAngle = this.initialLeftArmAngle;
    this.currentLeftArmLength = this.initialLeftArmLength;

    this.leftArmBaseX = this.armJointX;
    this.leftArmBaseY = this.armJointY;
  }
  
  update() {
    // 表情动画：偶尔低头、抬头、抹眼泪
    if (tearDrop && this.tearCount < 3) {
      this.eyeY = -8; // 更悲伤的表情
      this.mouthY = 12;
      this.tearCount++;
      
      setTimeout(() => {
        if (this.tearCount >= 3) {
          this.eyeY = -5;
          this.mouthY = 10;
          tearDrop = false;
        }
      }, 800);
    }

    // --- 抹眼泪动画更新逻辑 ---
    if (this.leftArmState !== "default") {
      let elapsed = millis() - this.leftArmStartTime;
      let stageDuration = 600; // 每个阶段的持续时间
      this.leftArmProgress = constrain(elapsed / stageDuration, 0, 1);

      if (this.leftArmState === "lifting") {
        // 从初始状态插值到抬起状态
        this.currentLeftArmAngle = lerp(this.initialLeftArmAngle, this.liftLeftArmAngle, this.leftArmProgress);
        this.currentLeftArmLength = lerp(this.initialLeftArmLength, this.liftLeftArmLength, this.leftArmProgress);

        if (this.leftArmProgress >= 1) {
          this.leftArmState = "wiping";
          this.leftArmStartTime = millis();
          this.wipeShakeStartTime = millis();
          this.eyeY = -3; // 擦眼睛时表情变化
          this.mouthY = 8;
        }
      } else if (this.leftArmState === "wiping") {
        // 在抬起位置小幅摆动
        let shakeElapsed = millis() - this.wipeShakeStartTime;
        let shakeCycleDuration = 300; // 摆动周期
        let shakeOffset = sin(map(shakeElapsed % shakeCycleDuration, 0, shakeCycleDuration, 0, TWO_PI)) * this.wipeShakeAngle;
        this.currentLeftArmAngle = this.wipeLeftArmAngle + shakeOffset;
        this.currentLeftArmLength = this.wipeLeftArmLength;

        if (this.leftArmProgress >= 1) {
          this.leftArmState = "returning";
          this.leftArmStartTime = millis();
        }
      } else if (this.leftArmState === "returning") {
        // 返回初始状态
        this.currentLeftArmAngle = lerp(this.wipeLeftArmAngle, this.returnLeftArmAngle, this.leftArmProgress);
        this.currentLeftArmLength = lerp(this.wipeLeftArmLength, this.returnLeftArmLength, this.leftArmProgress);

        if (this.leftArmProgress >= 1) {
          this.leftArmState = "default";
          this.eyeY = -5; // 恢复表情
          this.mouthY = 10;
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
    
    // ---------------------- 绘制心情值竖长方形 ----------------------
    const moodBoxX = 30; 
    const moodBoxY = -30; 
    const moodBoxWidth = 12; 
    const moodBoxHeight = 45; 

    // 绘制空心方框边框（黑色）
    stroke(0);
    strokeWeight(1.4);
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
    const quantTextSize = 10;
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

      effect.horizontalPhase += effect.horizontalFrequency;
      effect.horizontalOffset = sin(effect.horizontalPhase) * effect.horizontalAmplitude;
        // 应用重力效果，让上升速度逐渐变慢
      effect.y -= map(effect.alpha, 255, 0, 0.2, 0.8);
      // 绘制文字
      fill(46, 125, 50, effect.alpha);
      textSize(12);
      textAlign(CENTER, CENTER);
      text(effect.value, effect.x - this.x + effect.horizontalOffset, effect.y - this.y);
      // 移除透明度<0的特效
      if (effect.alpha < 0) {
        floatTextEffects.splice(i, 1);
      }
    }

    stroke(0);
    strokeWeight(2);

    
    // 画两只眼睛
    fill(0);
    ellipse(-5, this.eyeY, 2, 2); // 左眼
    ellipse(5, this.eyeY, 2, 2);  // 右眼

    // 悲伤嘴巴：向下弯的弧线（贴住脸边缘，只画右半边）
    noFill();
    if(moodValue<=80){
      arc(0, this.mouthY, 15, 8, PI*10/9, -PI/9); // 从左到右画半圆，只显示右半部分
    }else{
      line(-5,7,5,7)
    }
    

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

  wipeTears() {
    if (this.leftArmState === "default") {
      this.leftArmState = "lifting";
      this.leftArmStartTime = millis();
      this.leftArmProgress = 0;
      this.eyeY = -4;
      this.mouthY = 9;
      this.tearCount = 1; // 重置掉泪计数
    }
  }
}

class Passerby {
  constructor(side) {
    this.side = side;
    this.x = side === 'left' ? -50 : width + 50;
    this.y = height * 0.75 - 65; // 脚底对齐地面线
    this.speed = WALK_SPEED;
    this.hasInteracted = false;
    this.interactionTimer = 0;
    this.walkFrame = 0;
    this.message = "";
  }

  update() {
    if (this.side === 'left') {
      this.x += this.speed;
    } else {
      this.x -= this.speed;
    }

    // 行走动画
    this.walkFrame += WALK_FRAME_SPEED;
    if (this.walkFrame > 2) this.walkFrame = 0;

    // 当走到主角附近时互动
    if (!this.hasInteracted && abs(this.x - mainCharacter.x) < 50) {
      this.hasInteracted = true;
      this.interactionTimer = millis();

      setTimeout(() => {
        if (moodValue < 80) { // 只有心情值低时才触发安慰
          mainCharacter.wipeTears();
        }
      }, 200);

      // setTimeout(() => {
      //   this.message = "";
      //   showTemporaryMessage("路人安慰了小人", 1000);
      // }, 500);
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

    // 侧脸
    if (this.side === 'left') {
      fill(0);
      ellipse(5, -5, 2, 2); // 右眼

      noFill();
      arc(11, 5, 19, 8, PI/2, PI); // 笑脸
    } else {
      fill(0);
      ellipse(-5, -5, 2, 2); // 左眼

      noFill();
      arc(-11, 5, 19, 8, 0, PI/2); // 笑脸
    }

    // 躯干
    line(0, 15, 0, 45);

    // 腿部行走动画
    let legPhase = sin(this.walkFrame * PI);
    let legOffset = map(abs(legPhase), 0, 1, 0, 1) * 5 * (legPhase > 0 ? 1 : -1);
    line(0, 45, -5 + legOffset, 65); // 左腿
    line(0, 45, 5 - legOffset, 65);  // 右腿

    // 手臂摆动动画
    let armPhase = cos(this.walkFrame * PI + PI*1.44);
    let armOffset = map(abs(armPhase), 0, 1, 0, 1) * 5 * (armPhase > 0 ? 1 : -1);
    line(0, 25, -4.5 + armOffset, 35); // 左臂
    line(0, 25, 4.5 - armOffset, 35);  // 右臂

    // 显示安慰语句
    // if (this.message) {
    //   fill(0);
    //   noStroke();
    //   textAlign(CENTER, CENTER);
    //   textSize(12);
    //   text(this.message, 0, -35);
      
    //   // 气泡框
    //   stroke(0);
    //   fill(255, 200);
    //   ellipse(0, -38, 40, 20);
    // }

    pop();
  }

  isOffScreen() {
    if (this.side === 'left') {
      return this.x > width + 30;
    } else {
      return this.x < -30;
    }
  }
}

// ---------------------- 窗口调整 ----------------------
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  leftWristHistory = [];
  rightWristHistory = [];
}