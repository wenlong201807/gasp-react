import * as THREE from 'three';
import type { CameraMode, DrivingState } from '../types';

/* ------------------------------------------------------------------ */
/* 锁定常量（计划 Task 4 Step 1，禁止调整）                            */
/* ------------------------------------------------------------------ */
const LERP_RATE = 4; // 平滑系数：k = 1 - exp(-4·dt)，帧率无关

interface CameraPose {
	pos: THREE.Vector3;
	lookTarget: THREE.Vector3;
}

/** 三档机位（锁定）：pos → lookAt 注视点 */
const POSES: Record<CameraMode, CameraPose> = {
	/* 追尾：车后上方俯看前方路面 */
	chase: { pos: new THREE.Vector3(0, 3.2, 8.5), lookTarget: new THREE.Vector3(0, 1.2, -6) },
	/* 驾驶位：座舱左舵高度，看向正前远方 */
	driver: {
		pos: new THREE.Vector3(-0.35, 1.25, -0.3),
		lookTarget: new THREE.Vector3(-0.35, 1.15, -10),
	},
	/* 侧方：右前侧低机位跟拍 */
	side: { pos: new THREE.Vector3(7.5, 1.6, 1.5), lookTarget: new THREE.Vector3(0, 0.9, -1) },
};

/**
 * 相机装配：三档机位间的平滑过渡。
 * 位置与注视点各自指数平滑 lerp 后 lookAt（注视点连续插值即朝向平滑，等效四元数 slerp 观感）。
 * 构造时直接贴合初始档位，避免开场漂移；每帧读取 state.cameraMode，setCameraMode 只需改 state。
 */
export class CameraRig {
	private camera: THREE.PerspectiveCamera;
	private currentPos: THREE.Vector3;
	private currentLookTarget: THREE.Vector3;

	constructor(camera: THREE.PerspectiveCamera, initialMode: CameraMode = 'chase') {
		this.camera = camera;
		const pose = POSES[initialMode];
		this.currentPos = pose.pos.clone();
		this.currentLookTarget = pose.lookTarget.clone();
		this.camera.position.copy(this.currentPos);
		this.camera.lookAt(this.currentLookTarget);
	}

	update(dt: number, state: DrivingState): void {
		const pose = POSES[state.cameraMode];
		const k = 1 - Math.exp(-LERP_RATE * dt);
		this.currentPos.lerp(pose.pos, k);
		this.currentLookTarget.lerp(pose.lookTarget, k);
		this.camera.position.copy(this.currentPos);
		this.camera.lookAt(this.currentLookTarget);
	}

	/** 相机由引擎持有（负责创建与 renderer 释放），本系统无 GPU 资源，仅保持系统签名一致 */
	dispose(): void {
		// no-op
	}
}
