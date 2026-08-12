extends MelodyObject
class_name Boss_AdamSmasher


var bgm_stream: AudioStream = preload("res://Level/Melody/边缘行者/BossBGM.ogg")


var bpm: int = 127




const SFX_HURT: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_hurt.wav")
const SFX_Dead: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_爆炸音效.wav")
const SFX_READY: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_ready.wav")
const SFX_COUNTER: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_counter.wav")
const SFX_HIT_INVINCIBLE: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_hit_invincible.wav")
const SFX_ATTACK_NORMAL: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_attack_normal.wav")
const SFX_ATTACK_UP: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_attack_up.wav")
const SFX_ATTACKDOWN_RISE: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_attackdown_rise.wav")
const SFX_ATTACK_DOWN: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_attack_down.wav")
const SFX_FALLDOWN: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_falldown.wav")
const SFX_ATTACK_RANGE: AudioStreamWAV = preload("res://Level/Melody/边缘行者/SFX/sfx_attack_range.wav")
const SFX_SANDEVISTAN = preload("res://Level/Melody/边缘行者/SFX/sfx_sandevistan.wav")


const PERFECT_FX = preload("res://Level/Melody/边缘行者/Counter/perfect_fx.tscn")
const COUNTER_FX = preload("res://Level/Melody/边缘行者/Counter/CounterFx.tscn")
const DASH_FX: PackedScene = preload("res://Level/Melody/边缘行者/亚当重锤冲刺特效.tscn")
const DEAD_FX: PackedScene = preload("res://Level/Melody/边缘行者/亚当重锤死亡特效.tscn")
const Missile: PackedScene = preload("res://Level/Melody/边缘行者/亚当重锤导弹.tscn")





enum BossState{
	Disable, 
	Show, 
	Idle, 
	Fall, 
	Walk, 
	Attack, 
	Hurt, 
	Electric_Hurt, 
	Dead, 
}


enum ActionType{
	Idle, 
	Walk, 
	AttackNormal, 
	AttackUp, 
	AttackRange, 
	AttackDown, 
}





const GRAVITY: float = 980.0


const MAX_FALL_SPEED: float = 1200.0





var action_weight: = {
	ActionType.Idle: 5.0, 
	ActionType.Walk: 20.0, 
	ActionType.AttackNormal: 30.0, 
	ActionType.AttackUp: 20.0, 
	ActionType.AttackRange: 15.0, 
	ActionType.AttackDown: 20.0, 
}


var action_last_used_beat: = {}


const ACTION_COOLDOWN_BEATS: = {
	ActionType.Idle: 1, 
	ActionType.Walk: 2, 
	ActionType.AttackNormal: 3, 
	ActionType.AttackUp: 4, 
	ActionType.AttackRange: 4, 
	ActionType.AttackDown: 4, 
}


const ATTACK_MAX_DISTANCE: = 640.0



const ATTACK_UP_WEIGHT_HIGH: float = 60.0


const ATTACK_UP_HEIGHT_THRESHOLD: float = 128
const ATTACK_NORMAL_MAX_HEIGHT_DIFF: float = 128


const RANGE_CLOSE: float = 200.0
const RANGE_MID: float = 400.0
const RANGE_FAR: float = 600.0





var current_beat_count: int = 0


var next_beat_time: float = 0.0


var action_interval: float = 2.0


var is_on_beat: bool = false




var current_state: BossState = BossState.Disable


var face_direction: int = -1


var original_position: Vector2


var is_active_boss: bool = false


var hurt_timer: float = 0.0
const hurt_duration: float = 0.5


var electric_hurt_duration: float = 2.0


var walk_speed: float = 96.0


var is_updated_action: bool = true


const KNOCKBACK_SPEED_X: float = 320.0


var dead_fx_triggered: = false

var _dead_sequence_id: = 0


var _current_tween: Tween = null


var is_super_armor: bool = false


var _cancel_attack: bool = false



var is_second_phase: bool = false




var final_attack_mode: bool = false


var boss_disabled: bool = false


var _frame_player_attacked: bool = false





var is_player_killed: bool = false


var bgm_fade_tween: Tween = null





const ATTACK_NORMAL_BASE_WEIGHT: float = 30.0


@export var dash_speed: float = 800.0


const ATTACK_NORMAL_TOTAL_BEATS: float = 2.0


const ATTACK_NORMAL_STOP_DISTANCE: float = 16.0


var _attack_normal_dash_start_time: float = 0.0
var _attack_normal_dash_duration: float = 0.0


var _is_attack_box_normal_active: bool = false




var _is_attack_box_up_active: bool = false
var _attack_up_dash_start_time: float = 0.0
var _attack_up_dash_duration: float = 0.0


var attack_up_target_offset: Vector2 = Vector2(10, 5)


var _attack_up_tween_x: Tween = null
var _attack_up_tween_y: Tween = null


const ATTACK_UP_STOP_DISTANCE: float = 32.0


const ATTACK_UP_TOTAL_BEATS: float = 1.5


var _attack_up_in_dash: bool = false




var waiting_for_beat_to_attack_down: bool = false
var _is_attack_box_down_active: bool = false


var _attack_down_rise_tween: Tween = null
var _attack_down_fall_tween: Tween = null


const ATTACK_DOWN_RISE_Y: float = -284.0

const ATTACK_DOWN_FALL_Y: float = 256.0





var waiting_for_beat_to_attack_range: bool = false


var shader_material: ShaderMaterial




@onready var boss: CharacterBody2D = $"."
@onready var animated_sprite_2d: AnimatedSprite2D = $AnimatedSprite2D
@onready var judge_circle: Sprite2D = $"AnimatedSprite2D/判定圈"
@onready var dead_fx_position: Node2D = $AnimatedSprite2D / DeadFXPosition
@onready var dash_fx_position: Node2D = $AnimatedSprite2D / DashFXPosition
@onready var range_attack_position: Node2D = $AnimatedSprite2D / RangeAttackPosition
@onready var collision_shape_2d: CollisionShape2D = $CollisionShape2D
@onready var walk_audio_player: AudioStreamPlayer = $WalkAudioPlayer
@onready var after_image_spawner: AfterImageSpawner = $AfterImageSpawner
@onready var hurt_box: Area2D = $AnimatedSprite2D / HurtBox



@onready var attack_box_normal: Area2D = $AnimatedSprite2D / AttackAreaList / AttackBox_Normal
@onready var attack_box_up: Area2D = $AnimatedSprite2D / AttackAreaList / AttackBox_Up
@onready var attack_box_down: Area2D = $AnimatedSprite2D / AttackAreaList / AttackBox_Down

var camera: CameraControl
var player: Player





@export var dodge_left_point: Node2D

@export var dodge_right_point: Node2D


var is_dodging: bool = false




signal signal_boss_hurt(hurt_amount: int)
signal signal_finish_boss
signal signal_super_AttackDown
signal signal_final_attack




func _ready() -> void :
	super._ready()
	AudioManager.register_extra_player(walk_audio_player)
	shader_material = animated_sprite_2d.material
	camera = GlobalNode.camera_control
	player = GlobalNode.player
	original_position = global_position
	init_action_data()
	init_boss_data()

	attack_box_normal.body_entered.connect(_on_attack_box_body_entered)
	attack_box_up.body_entered.connect(_on_attack_box_body_entered)
	attack_box_down.body_entered.connect(_on_attack_box_body_entered)
	attack_box_normal.area_entered.connect(_on_attack_box_normal_area_entered)
	attack_box_up.area_entered.connect(_on_attack_box_up_area_entered)
	walk_audio_player.volume_db = AudioManager.sfx_players[0].volume_db

	level.signal_dead.connect(_on_level_signal_dead)


func init_action_data() -> void :
	for a in ActionType.values():
		action_last_used_beat[a] = -999


func init_boss_data() -> void :
	_dead_sequence_id += 1
	dead_fx_triggered = false
	face_direction = -1
	animated_sprite_2d.scale.x = face_direction
	boss.velocity = Vector2.ZERO
	global_position = original_position
	is_active_boss = false
	current_state = BossState.Disable
	current_beat_count = 0
	next_beat_time = 0.0
	is_on_beat = false
	is_updated_action = true
	animated_sprite_2d.play("Disable")
	hurt_timer = 0
	_cancel_attack = false
	waiting_for_beat_to_attack_down = false
	waiting_for_beat_to_attack_range = false
	_set_attack_box_normal(false)
	_set_attack_box_up(false)
	_set_attack_box_down(false)
	_current_tween = null
	_attack_normal_dash_start_time = 0.0
	_attack_normal_dash_duration = 0.0
	_attack_up_tween_x = null
	_attack_up_tween_y = null
	_attack_up_dash_start_time = 0.0
	_attack_up_dash_duration = 0.0
	_attack_up_in_dash = false
	_attack_down_rise_tween = null
	_attack_down_fall_tween = null
	judge_circle.visible = false
	judge_circle.scale = Vector2.ONE
	set_super_armor(false)
	walk_audio_player.stop()
	final_attack_mode = false
	boss_disabled = false
	_frame_player_attacked = false
	is_player_killed = false
	is_dodging = false
	if bgm_fade_tween:
		bgm_fade_tween.kill()
	AudioManager.adjust_bgm_volume(GameData.bgm_volume)
	_update_hurt_box_state()
	is_second_phase = false

func reset() -> void :
	super.reset()
	_stop_all_behaviors()
	after_image_spawner.clear_all_afterimages()
	if AudioManager.bgm_player.stream == bgm_stream:
		AudioManager.bgm_player.stop()
		AudioManager.bgm_player.stream = GameData.level_bgm_stream
		AudioManager.bgm_player.play(0)
	GameData.bpm = GameData.origin_bpm
	init_action_data()
	init_boss_data()
	is_active_boss = false
	action_weight[ActionType.AttackNormal] = ATTACK_NORMAL_BASE_WEIGHT
	waiting_for_beat_to_attack_down = false
	waiting_for_beat_to_attack_range = false
	_set_attack_box_normal(false)
	_set_attack_box_up(false)
	_set_attack_box_down(false)
	player.attack_active_frame_start = 2
	set_super_armor(false)
	if _is_hitstop_active:
		_is_hitstop_active = false
		Engine.time_scale = 1.0
	final_attack_mode = false
	boss_disabled = false
	_frame_player_attacked = false
	is_player_killed = false
	is_dodging = false
	if bgm_fade_tween:
		bgm_fade_tween.kill()
	AudioManager.adjust_bgm_volume(GameData.bgm_volume)
	is_second_phase = false
	Engine.time_scale = 1.0



func set_super_armor(enabled: bool) -> void :
	is_super_armor = enabled
	if shader_material:
		shader_material.set_shader_parameter("outline_enabled", enabled)




func _physics_process(delta: float) -> void :
	if not is_active_boss:
		return
	update_state(delta)
	boss.move_and_slide()


func _process(_delta: float) -> void :
	_frame_player_attacked = false

	if not is_active_boss:
		return

	if boss_disabled:
		return

	if current_state in [BossState.Dead, BossState.Disable]:
		return

	if is_player_killed:
		is_on_beat = false
		waiting_for_beat_to_attack_down = false
		waiting_for_beat_to_attack_range = false
		is_updated_action = false
		return

	if player != null and player.is_dead and not final_attack_mode:
		is_on_beat = false
		waiting_for_beat_to_attack_down = false
		waiting_for_beat_to_attack_range = false
		return

	update_beat()

	if is_on_beat and is_updated_action:
		is_on_beat = false
		is_updated_action = false
		update_boss_action()

	elif is_on_beat and waiting_for_beat_to_attack_down:
		is_on_beat = false
		waiting_for_beat_to_attack_down = false
		_execute_attack_down()

	elif is_on_beat and waiting_for_beat_to_attack_range:
		is_on_beat = false
		waiting_for_beat_to_attack_range = false
		_execute_attack_range()




func update_beat() -> void :
	var bgm_time: float = AudioManager.get_bgm_time()
	if bgm_time <= 0.0:
		return
	var beat_duration: float = 60.0 / bpm * action_interval
	if next_beat_time == 0.0:
		next_beat_time = beat_duration
	if bgm_time >= next_beat_time:
		next_beat_time += beat_duration
		current_beat_count += 1
		is_on_beat = true






func get_action_weight(action: ActionType) -> float:

	if action == ActionType.AttackRange and not is_second_phase:
		return 0.0


	var beats_since: int = current_beat_count - action_last_used_beat[action]
	if beats_since < ACTION_COOLDOWN_BEATS[action]:
		return 0.0

	var base: float = action_weight[action]
	if base == 0.0:
		return 0.0

	if player == null:
		if action in [ActionType.AttackNormal, ActionType.AttackUp, ActionType.AttackRange, ActionType.AttackDown]:
			return 0.0
		return base

	var player_pos: Vector2 = player.global_position
	var boss_pos: Vector2 = boss.global_position
	var dist: float = boss_pos.distance_to(player_pos)
	var h_dist: float = abs(boss_pos.x - player_pos.x)
	var height_diff: float = boss_pos.y - player_pos.y

	if action in [ActionType.AttackNormal, ActionType.AttackUp, ActionType.AttackRange, ActionType.AttackDown]:
		if dist > ATTACK_MAX_DISTANCE:
			return 0.0

	match action:
		ActionType.AttackNormal:
			if height_diff > ATTACK_NORMAL_MAX_HEIGHT_DIFF:
				return 0.0
			if h_dist > RANGE_FAR:
				base *= 0.1
			elif h_dist > RANGE_MID:
				base *= 0.4

		ActionType.AttackUp:
			if height_diff < ATTACK_UP_HEIGHT_THRESHOLD:
				return 0.0
			base = ATTACK_UP_WEIGHT_HIGH
			if h_dist > RANGE_FAR:
				base *= 0.2
			elif h_dist > RANGE_MID:
				base *= 0.6

		ActionType.AttackRange:
			if height_diff > ATTACK_UP_HEIGHT_THRESHOLD:
				base *= 1.8
			if h_dist > RANGE_FAR:
				base *= 2.5
			elif h_dist > RANGE_MID:
				base *= 1.8

		ActionType.AttackDown:
			if height_diff > ATTACK_UP_HEIGHT_THRESHOLD:
				base *= 2.0
			if h_dist > RANGE_FAR:
				base *= 2.0
			elif h_dist > RANGE_MID:
				base *= 1.6

		ActionType.Walk:
			if dist < 40.0:
				base *= 0.1

		ActionType.Idle:
			pass

	return base




func update_boss_action() -> void :
	if is_player_killed:
		return
	execute_action(ActionType.AttackNormal)


func execute_action(action: ActionType) -> void :
	match action:
		ActionType.Walk:
			is_updated_action = true
			if player != null:
				var dir: int = sign(player.global_position.x - boss.global_position.x)
				if dir != 0:
					boss_walk(dir)
		ActionType.Idle:
			is_updated_action = true
			boss_idle()
		ActionType.AttackNormal:
			boss_attack(ActionType.AttackNormal)
		ActionType.AttackUp:
			boss_attack(ActionType.AttackUp)
		ActionType.AttackRange:
			boss_attack(ActionType.AttackRange)
		ActionType.AttackDown:
			boss_attack(ActionType.AttackDown)




func update_state(delta: float) -> void :
	match current_state:
		BossState.Disable:
			pass
		BossState.Show:
			_apply_gravity(delta)
		BossState.Idle:
			_apply_gravity(delta)
			if boss.is_on_floor():
				boss.velocity.y = 0.0
		BossState.Walk:
			boss.velocity.x = face_direction * walk_speed
		BossState.Attack:
			if _attack_up_in_dash:
				boss.velocity = Vector2.ZERO
			else:
				boss.velocity.x = 0.0
		BossState.Fall:
			_apply_gravity(delta)
			if boss.is_on_floor():
				boss.velocity.y = 0.0
				change_state(BossState.Idle)
				AudioManager.trigger_sfx(SFX_FALLDOWN)
		BossState.Hurt:
			_set_attack_box_down(false)
			_set_attack_box_normal(false)
			_set_attack_box_up(false)
			_apply_gravity(delta)
			if boss.is_on_floor():
				boss.velocity.y = 0.0
			boss.velocity.x *= 0.9
			hurt_timer -= delta
			if hurt_timer <= 0.0:
				if boss.is_on_floor():
					is_updated_action = true
					change_state(BossState.Idle)
				else:
					is_updated_action = false
					change_state(BossState.Fall)
		BossState.Electric_Hurt:
			_set_attack_box_down(false)
			_set_attack_box_normal(false)
			_set_attack_box_up(false)
			_apply_gravity(delta)
			if boss.is_on_floor():
				boss.velocity.y = 0.0
			boss.velocity.x *= 0.9
			hurt_timer -= delta
			if hurt_timer <= 0.0:
				if boss.is_on_floor():
					is_updated_action = true
					change_state(BossState.Idle)
				else:
					is_updated_action = false
					change_state(BossState.Fall)
		BossState.Dead:
			_set_attack_box_down(false)
			_set_attack_box_normal(false)
			_set_attack_box_up(false)
			_apply_gravity(delta)
			if boss.is_on_floor():
				boss.velocity.y = 0.0
			boss.velocity.x = 0.0
			var anim: = animated_sprite_2d.animation
			if anim == "Dead":
				var frame: = animated_sprite_2d.frame
				var total: = animated_sprite_2d.sprite_frames.get_frame_count("Dead")
				if frame >= total - 1:
					_finish_death_once()


func _apply_gravity(delta: float) -> void :
	if boss.is_on_floor():
		boss.velocity.y = 0.0
	else:
		boss.velocity.y = minf(boss.velocity.y + GRAVITY * delta, MAX_FALL_SPEED)




func change_state(new_state: BossState) -> void :
	if current_state == new_state:
		return

	if current_state == BossState.Dead and new_state != BossState.Disable:
		return
	_exit_state(current_state)
	current_state = new_state
	_enter_state(new_state)


func _enter_state(state: BossState) -> void :
	match state:
		BossState.Disable:
			collision_shape_2d.disabled = true
			animated_sprite_2d.play("Disable")
			is_updated_action = false
		BossState.Show:
			animated_sprite_2d.play("Show")
			is_updated_action = false
			walk_audio_player.play()
		BossState.Idle:
			is_updated_action = true
			boss.velocity.x = 0.0
			animated_sprite_2d.play("Idle")
		BossState.Fall:
			animated_sprite_2d.play("Fall")
			is_updated_action = false
		BossState.Walk:
			animated_sprite_2d.play("Walk")
			walk_audio_player.play()
		BossState.Hurt:
			set_super_armor(false)
			animated_sprite_2d.play("Hurt")
			hurt_timer = hurt_duration
			is_updated_action = false
		BossState.Electric_Hurt:
			set_super_armor(false)
			animated_sprite_2d.play("ElectricHurt")
			hurt_timer = electric_hurt_duration
			is_updated_action = false
		BossState.Dead:
			dead_fx_triggered = false
			_dead_sequence_id += 1
			is_updated_action = false
			_start_dead_slow_motion()
			_start_dead_finish_watchdog(_dead_sequence_id)


			animated_sprite_2d.stop()
			animated_sprite_2d.play("Dead")


func _exit_state(state: BossState) -> void :
	match state:
		BossState.Disable:
			collision_shape_2d.disabled = false
			is_updated_action = true
		BossState.Show:
			is_updated_action = true
			walk_audio_player.stop()
		BossState.Walk:
			boss.velocity.x = 0.0
			walk_audio_player.stop()
		BossState.Hurt:
			pass
		BossState.Electric_Hurt:
			pass
		BossState.Fall:
			is_updated_action = true




func _on_animated_sprite_2d_animation_finished() -> void :
	match animated_sprite_2d.animation:
		"Show":
			change_state(BossState.Idle)

		"AttackNormalReady":
			_start_attack_normal_charge()
		"AttackNormal":
			after_image_spawner.stop_spawning()
			_set_attack_box_normal(false)
			is_updated_action = true
			change_state(BossState.Idle)

		"AttackUpReady":
			_start_attack_up_charge()
		"AttackUp":
			after_image_spawner.stop_spawning()
			_set_attack_box_up(false)
			_attack_up_in_dash = false
			is_updated_action = true
			change_state(BossState.Fall)

		"AttackDownReady":
			waiting_for_beat_to_attack_down = true
			animated_sprite_2d.pause()
		"AttackDown":
			_set_attack_box_down(false)
			if final_attack_mode:
				boss_disabled = true
				is_updated_action = false
				final_attack_mode = false
				change_state(BossState.Idle)
				set_super_armor(false)
			else:
				is_updated_action = true
				change_state(BossState.Idle)
				set_super_armor(false)

		"AttackRangeReady":
			waiting_for_beat_to_attack_range = true
			animated_sprite_2d.pause()
		"AttackRange":
			set_super_armor(false)
			is_updated_action = true
			change_state(BossState.Idle)

		"Dead":
			_finish_death_once()




func _set_attack_box_normal(enabled: bool) -> void :
	_is_attack_box_normal_active = enabled
	attack_box_normal.set_deferred("monitoring", enabled)
	_update_hurt_box_state()


func _start_attack_normal_charge() -> void :
	if player == null:
		is_updated_action = true
		change_state(BossState.Idle)
		return

	var dir_to_player: int = sign(player.global_position.x - boss.global_position.x)
	if dir_to_player == 0:
		dir_to_player = face_direction
	var target_x: float = player.global_position.x - dir_to_player * ATTACK_NORMAL_STOP_DISTANCE
	var dist: float = abs(target_x - boss.global_position.x)
	var beat_sec: float = 60.0 / bpm
	var max_dash_time: float = ATTACK_NORMAL_TOTAL_BEATS * beat_sec
	var travel_time: float = clamp(dist / dash_speed, beat_sec * 0.5, max_dash_time)
	var wait_time: float = max_dash_time - travel_time

	if wait_time > 0.0:
		animated_sprite_2d.pause()
		await get_tree().create_timer(wait_time, false, false, true).timeout

		if _cancel_attack or not is_active_boss or current_state != BossState.Attack:
			after_image_spawner.stop_spawning()
			_set_attack_box_normal(false)
			judge_circle.visible = false
			return
	_execute_attack_normal(travel_time)


func _execute_attack_normal(travel_time: float) -> void :
	if _cancel_attack:
		_set_attack_box_normal(false)
		judge_circle.visible = false
		return

	set_super_armor(false)
	if player == null:
		is_updated_action = true
		change_state(BossState.Idle)
		return

	var dir_to_player: int = sign(player.global_position.x - boss.global_position.x)
	if dir_to_player == 0:
		dir_to_player = face_direction

	var target_x: float = player.global_position.x - dir_to_player * ATTACK_NORMAL_STOP_DISTANCE
	var target_pos: = Vector2(target_x, boss.global_position.y)

	if dir_to_player != 0:
		face_direction = dir_to_player
		animated_sprite_2d.scale.x = face_direction

	_attack_normal_dash_start_time = Time.get_ticks_msec() / 1000.0
	_attack_normal_dash_duration = travel_time

	judge_circle.visible = true
	judge_circle.scale = Vector2.ONE
	var circle_tween: = create_tween()
	circle_tween.tween_property(judge_circle, "scale", Vector2(0.5, 0.5), travel_time)

	_set_attack_box_normal(true)
	animated_sprite_2d.play("AttackNormal")
	AudioManager.trigger_sfx(SFX_ATTACK_NORMAL)
	generate_dash_fx()

	_current_tween = create_tween()
	_current_tween.tween_property(boss, "global_position", target_pos, travel_time)
	boss.velocity = Vector2.ZERO

	await _current_tween.finished
	after_image_spawner.stop_spawning()
	_set_attack_box_normal(false)
	judge_circle.visible = false
	judge_circle.scale = Vector2.ONE




func _set_attack_box_up(enabled: bool) -> void :
	_is_attack_box_up_active = enabled
	attack_box_up.set_deferred("monitoring", enabled)
	_update_hurt_box_state()


func _start_attack_up_charge() -> void :
	if player == null:
		is_updated_action = true
		change_state(BossState.Idle)
		return

	var to_player: Vector2 = player.global_position - boss.global_position
	var dir_normalized: Vector2 = to_player.normalized()
	var dir_x: int = sign(to_player.x)
	var offset: = attack_up_target_offset
	offset.x *= dir_x

	var target_pos: Vector2 = player.global_position + offset - dir_normalized * ATTACK_UP_STOP_DISTANCE
	var dist: float = boss.global_position.distance_to(target_pos)
	var beat_sec: float = 60.0 / bpm
	var max_dash_time: float = ATTACK_UP_TOTAL_BEATS * beat_sec
	var travel_time: float = clamp(dist / dash_speed, beat_sec * 0.5, max_dash_time)
	var wait_time: float = max_dash_time - travel_time

	if wait_time > 0.0:
		animated_sprite_2d.pause()
		await get_tree().create_timer(wait_time, false, false, true).timeout

		if _cancel_attack or not is_active_boss or current_state != BossState.Attack:
			after_image_spawner.stop_spawning()
			_set_attack_box_up(false)
			judge_circle.visible = false
			return
	_execute_attack_up(travel_time)


func _execute_attack_up(travel_time: float) -> void :
	if _cancel_attack:
		_set_attack_box_up(false)
		judge_circle.visible = false
		return

	set_super_armor(false)
	if player == null:
		is_updated_action = true
		change_state(BossState.Idle)
		return

	var to_player: Vector2 = player.global_position - boss.global_position
	var dir_normalized: Vector2 = to_player.normalized()
	var dir_x: int = sign(to_player.x)
	var offset: = attack_up_target_offset
	offset.x *= dir_x

	var target_pos: Vector2 = player.global_position + offset - dir_normalized * ATTACK_UP_STOP_DISTANCE

	if dir_x != 0:
		face_direction = dir_x
		animated_sprite_2d.scale.x = face_direction

	_attack_up_dash_start_time = Time.get_ticks_msec() / 1000.0
	_attack_up_dash_duration = travel_time

	judge_circle.visible = true
	judge_circle.scale = Vector2.ONE
	var circle_tween: = create_tween()
	circle_tween.tween_property(judge_circle, "scale", Vector2(0.5, 0.5), travel_time)

	_set_attack_box_up(true)
	_attack_up_in_dash = true
	animated_sprite_2d.play("AttackUp")
	AudioManager.trigger_sfx(SFX_ATTACK_UP)
	generate_dash_fx()

	_attack_up_tween_x = create_tween()
	_attack_up_tween_x.tween_property(boss, "global_position:x", target_pos.x, travel_time)

	_attack_up_tween_y = create_tween()
	_attack_up_tween_y.tween_property(boss, "global_position:y", target_pos.y, travel_time)\
	.set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_CIRC)

	boss.velocity = Vector2.ZERO

	await _attack_up_tween_y.finished
	after_image_spawner.stop_spawning()
	_set_attack_box_up(false)
	_attack_up_in_dash = false

	judge_circle.visible = false
	judge_circle.scale = Vector2.ONE


func _on_attack_box_up_area_entered(area: Area2D) -> void :
	if not area.is_in_group("attack_hit_box"):
		return
	if not _is_attack_box_up_active:
		return

	var elapsed: float = Time.get_ticks_msec() / 1000.0 - _attack_up_dash_start_time
	var window_center: float = _attack_up_dash_duration - GameData.great_time
	var diff: float = abs(elapsed - window_center)

	if diff <= GameData.great_time:
		AudioManager.trigger_sfx(SFX_COUNTER)
		generate_counter_fx()
		if _attack_up_tween_x != null and _attack_up_tween_x.is_running():
			_attack_up_tween_x.kill()
		if _attack_up_tween_y != null and _attack_up_tween_y.is_running():
			_attack_up_tween_y.kill()
		_attack_up_in_dash = false
		_set_attack_box_up(false)
		judge_circle.visible = false
		judge_circle.scale = Vector2.ONE
		set_super_armor(false)
		_on_hurt_box_area_entered(area, true)




func _set_attack_box_down(enabled: bool) -> void :
	_is_attack_box_down_active = enabled
	attack_box_down.set_deferred("monitoring", enabled)


func _execute_attack_down() -> void :
	if player == null:
		is_updated_action = true
		change_state(BossState.Idle)
		set_super_armor(false)
		if final_attack_mode:
			final_attack_mode = false
			boss_disabled = true
		return

	if _attack_down_rise_tween:
		_attack_down_rise_tween.kill()
	if _attack_down_fall_tween:
		_attack_down_fall_tween.kill()

	var dir_to_player: int = sign(player.global_position.x - boss.global_position.x)
	if dir_to_player != 0:
		face_direction = dir_to_player
		animated_sprite_2d.scale.x = face_direction

	var start_x: float = boss.global_position.x
	var rise_target: Vector2 = Vector2(start_x, ATTACK_DOWN_RISE_Y)

	var rise_time: float = 0.5
	var beat_sec: float = 60.0 / bpm
	var fall_time: float = beat_sec

	animated_sprite_2d.play("AttackDownRise")
	AudioManager.trigger_sfx(SFX_ATTACKDOWN_RISE)

	_attack_down_rise_tween = create_tween()
	_attack_down_rise_tween.tween_property(boss, "global_position", rise_target, rise_time).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
	await _attack_down_rise_tween.finished

	animated_sprite_2d.play("AttackDown")
	animated_sprite_2d.stop()
	animated_sprite_2d.frame = 0
	var fall_target: Vector2 = Vector2(player.global_position.x, ATTACK_DOWN_FALL_Y)
	boss.global_position.x = player.global_position.x
	_set_attack_box_down(true)

	_attack_down_fall_tween = create_tween()
	_attack_down_fall_tween.tween_property(boss, "global_position", fall_target, fall_time).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
	await _attack_down_fall_tween.finished

	camera.shake_once(5)
	AudioManager.trigger_sfx(SFX_ATTACK_DOWN)


	if is_second_phase:
		signal_super_AttackDown.emit()

	if final_attack_mode:
		signal_final_attack.emit()

	_set_attack_box_down(false)
	animated_sprite_2d.frame = 1
	animated_sprite_2d.play()




func _execute_attack_range() -> void :
	if player == null:
		is_updated_action = true
		change_state(BossState.Idle)
		set_super_armor(false)
		return

	animated_sprite_2d.play("AttackRange")
	AudioManager.trigger_sfx(SFX_ATTACK_RANGE)
	generate_missile()




func generate_missile() -> void :
	var missile_instance = Missile.instantiate()
	get_parent().add_child(missile_instance)
	missile_instance.global_position = range_attack_position.global_position
	missile_instance.scale.x = - face_direction




func _on_attack_box_body_entered(body: Node2D) -> void :
	if body != player:
		return
	if not (_is_attack_box_normal_active or _is_attack_box_up_active or _is_attack_box_down_active):
		return
	if player.is_dead:
		return
	if _frame_player_attacked:
		return

	_set_attack_box_normal(false)
	_set_attack_box_up(false)
	_set_attack_box_down(false)
	_attack_up_in_dash = false
	judge_circle.visible = false
	judge_circle.scale = Vector2.ONE

	waiting_for_beat_to_attack_down = false
	waiting_for_beat_to_attack_range = false
	is_updated_action = false

	is_player_killed = true

	camera.shake_once(5)
	level.signal_dead.emit.call_deferred(false)
	start_bgm_fade_out(5.0)


func _on_attack_box_normal_area_entered(area: Area2D) -> void :
	if not area.is_in_group("attack_hit_box"):
		return
	if not _is_attack_box_normal_active:
		return

	var elapsed: float = Time.get_ticks_msec() / 1000.0 - _attack_normal_dash_start_time
	var window_center: float = _attack_normal_dash_duration - GameData.great_time
	var diff: float = abs(elapsed - window_center)

	if diff <= GameData.great_time:
		AudioManager.trigger_sfx(SFX_COUNTER)
		generate_counter_fx()
		if _current_tween != null and _current_tween.is_running():
			_current_tween.kill()
		_set_attack_box_normal(false)
		judge_circle.visible = false
		judge_circle.scale = Vector2.ONE
		set_super_armor(false)
		_on_hurt_box_area_entered(area, true)




func _on_hurt_box_area_entered(area: Area2D, is_counter: bool = false) -> void :
	if current_state in [BossState.Dead, BossState.Disable]:
		return


	if is_dodging:
		return

	if _frame_player_attacked:
		return
	if area.is_in_group("attack_hit_box") or area.is_in_group("rebecca"):
		_frame_player_attacked = true

		if player == null or player.is_dead:
			return

		if is_super_armor and not area.is_in_group("rebecca"):
			if player:
				var dir: Vector2 = (player.global_position - boss.global_position).normalized()
				player.knockback(dir, 160.0)
				AudioManager.trigger_sfx(SFX_HIT_INVINCIBLE)
			return


		if area.is_in_group("rebecca"):

			if hurt_timer > 0:
				return
			signal_boss_hurt.emit(3)
			if player != null:
				var dir: int = sign(boss.global_position.x - player.global_position.x)
				boss.velocity = Vector2(dir * KNOCKBACK_SPEED_X, 0)
				if dir != 0:
					face_direction = - dir
					animated_sprite_2d.scale.x = face_direction
				AudioManager.trigger_sfx(SFX_COUNTER)
				generate_counter_fx()
				camera.shake_double(10)
				start_hitstop(0.12)
				player.animated_sprite_2d_left.frame = 2
				player.animated_sprite_2d_right.frame = 2
			_stop_all_behaviors()
			change_state(BossState.Hurt)
			return


		if current_state == BossState.Electric_Hurt:
			signal_boss_hurt.emit(3)
			if player != null:
				var dir: int = sign(boss.global_position.x - player.global_position.x)
				boss.velocity = Vector2(dir * KNOCKBACK_SPEED_X, 0)
				if dir != 0:
					face_direction = - dir
					animated_sprite_2d.scale.x = face_direction
				AudioManager.trigger_sfx(SFX_COUNTER)
				generate_counter_fx()
				camera.shake_double(10)
				start_hitstop(0.15)
				player.animated_sprite_2d_left.frame = 2
				player.animated_sprite_2d_right.frame = 2

			_stop_all_behaviors()
			change_state(BossState.Hurt)
			return


		if hurt_timer <= 0 and current_state in [BossState.Idle, BossState.Walk]:
			perform_dodge()
			return


		if hurt_timer <= 0:
			_stop_all_behaviors()
			change_state(BossState.Hurt)
			if player != null:
				var dir: int = sign(boss.global_position.x - player.global_position.x)
				boss.velocity = Vector2(dir * KNOCKBACK_SPEED_X, 0)
				if dir != 0:
					face_direction = - dir
					animated_sprite_2d.scale.x = face_direction
				AudioManager.trigger_sfx(SFX_HURT)
				if is_counter:
					camera.shake_double(10)
					signal_boss_hurt.emit(3)
					start_hitstop(0.15)
				else:
					camera.shake_once(5)
					signal_boss_hurt.emit(1)
					start_hitstop(0.1)
				player.animated_sprite_2d_left.frame = 2
				player.animated_sprite_2d_right.frame = 2


func _update_hurt_box_state() -> void :
	if not hurt_box:
		return

	var should_enable: = not (_is_attack_box_normal_active or _is_attack_box_up_active)
	hurt_box.set_deferred("monitoring", should_enable)




func perform_dodge() -> void :

	if not dodge_left_point or not dodge_right_point:
		return


	_stop_all_behaviors()
	is_updated_action = false
	is_dodging = true
	hurt_box.set_deferred("monitoring", false)


	var beat_duration: float = 60.0 / bpm * action_interval
	var bgm_time: float = AudioManager.get_bgm_time()
	next_beat_time = bgm_time + beat_duration + 0.5
	is_on_beat = false


	AudioManager.trigger_sfx(SFX_SANDEVISTAN)


	after_image_spawner.start_spawning()


	var pos_left = dodge_left_point.global_position
	var pos_right = dodge_right_point.global_position
	var dist_left = boss.global_position.distance_squared_to(pos_left)
	var dist_right = boss.global_position.distance_squared_to(pos_right)
	var target = pos_left if dist_left > dist_right else pos_right


	if player != null:
		var dir_to_player: int = sign(player.global_position.x - target.x)
		if dir_to_player != 0:
			face_direction = dir_to_player
			animated_sprite_2d.scale.x = face_direction


	change_state(BossState.Idle)


	var tween = create_tween()
	tween.tween_property(boss, "global_position", target, 0.5)\
	.set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	await tween.finished


	after_image_spawner.stop_spawning()
	boss.velocity = Vector2.ZERO
	hurt_box.set_deferred("monitoring", true)
	is_dodging = false


	waiting_for_beat_to_attack_down = false
	waiting_for_beat_to_attack_range = false
	_cancel_attack = false
	is_on_beat = false


	is_updated_action = true





var _is_hitstop_active: = false
var _hitstop_id: = 0
const HITSTOP_TIME_SCALE: = 0.01


var _is_dead_slowmo_active: = false
var _dead_slowmo_id: = 0

func start_hitstop(duration: float):

	if _is_dead_slowmo_active:
		return

	_hitstop_id += 1
	var my_id = _hitstop_id

	_is_hitstop_active = true

	Engine.time_scale = HITSTOP_TIME_SCALE

	await get_tree().create_timer(duration, true, false, true).timeout


	if my_id != _hitstop_id or _is_dead_slowmo_active:
		return

	Engine.time_scale = 1.0
	_is_hitstop_active = false


func _start_dead_slow_motion():

	_dead_slowmo_id += 1
	var my_slowmo_id = _dead_slowmo_id

	_hitstop_id += 1
	_is_hitstop_active = false
	_is_dead_slowmo_active = true

	Engine.time_scale = 0.2

	await get_tree().create_timer(1, true, false, true).timeout


	if my_slowmo_id != _dead_slowmo_id:
		return

	Engine.time_scale = 1.0
	_is_dead_slowmo_active = false






func _finish_death_once() -> void :
	if dead_fx_triggered or current_state != BossState.Dead:
		return

	dead_fx_triggered = true
	AudioManager.trigger_sfx(SFX_Dead)
	if camera:
		camera.shake_double(10)
	generate_dead_fx()

	if AudioManager.bgm_player.stream == bgm_stream:
		AudioManager.bgm_player.stop()
		AudioManager.bgm_player.stream = GameData.level_bgm_stream
		AudioManager.bgm_player.play(0)

	signal_finish_boss.emit()
	change_state(BossState.Disable)




func _start_dead_finish_watchdog(sequence_id: int) -> void :
	await get_tree().create_timer(4.0, true, false, true).timeout
	if sequence_id != _dead_sequence_id:
		return
	_finish_death_once()


func generate_counter_fx() -> void :
	var fx_instance = PERFECT_FX.instantiate()
	GlobalNode.fx_front.add_child(fx_instance)
	fx_instance.global_position = animated_sprite_2d.global_position
	var fx_instance2 = COUNTER_FX.instantiate()
	GlobalNode.fx_front.add_child(fx_instance2)
	fx_instance2.global_position = judge_circle.global_position


func generate_dead_fx() -> void :
	var fx_instance = DEAD_FX.instantiate()
	GlobalNode.fx_front.add_child(fx_instance)
	fx_instance.global_position = dead_fx_position.global_position


func generate_dash_fx() -> void :
	var fx_instance = DASH_FX.instantiate()
	GlobalNode.fx_front.add_child(fx_instance)
	fx_instance.global_position = dash_fx_position.global_position
	fx_instance.scale.x = - face_direction




func boss_idle() -> void :
	change_state(BossState.Idle)


func boss_walk(walk_direction: int = -1) -> void :
	face_direction = walk_direction
	animated_sprite_2d.scale.x = face_direction
	change_state(BossState.Walk)


func boss_attack(attack_type: ActionType) -> void :
	if not is_active_boss or boss_disabled:
		return
	if current_state in [BossState.Dead, BossState.Disable]:
		return

	_cancel_attack = false
	is_updated_action = false
	change_state(BossState.Attack)
	set_super_armor(true)


	if attack_type == ActionType.AttackNormal or attack_type == ActionType.AttackUp:
		after_image_spawner.start_spawning()
		AudioManager.trigger_sfx(SFX_SANDEVISTAN)
	else:
		AudioManager.trigger_sfx(SFX_READY)
	match attack_type:
		ActionType.AttackNormal:
			animated_sprite_2d.play("AttackNormalReady")
		ActionType.AttackUp:
			animated_sprite_2d.play("AttackUpReady")
		ActionType.AttackRange:
			animated_sprite_2d.play("AttackRangeReady")
		ActionType.AttackDown:
			animated_sprite_2d.play("AttackDownReady")




func _stop_all_behaviors() -> void :
	_cancel_attack = true

	if _current_tween:
		_current_tween.kill()
	if _attack_up_tween_x:
		_attack_up_tween_x.kill()
	if _attack_up_tween_y:
		_attack_up_tween_y.kill()
	if _attack_down_rise_tween:
		_attack_down_rise_tween.kill()
	if _attack_down_fall_tween:
		_attack_down_fall_tween.kill()
	waiting_for_beat_to_attack_down = false
	waiting_for_beat_to_attack_range = false
	_set_attack_box_normal(false)
	_set_attack_box_up(false)
	_set_attack_box_down(false)
	_attack_up_in_dash = false
	judge_circle.visible = false
	judge_circle.scale = Vector2.ONE
	after_image_spawner.stop_spawning()

	_update_hurt_box_state()




func start_bgm_fade_out(duration: float = 2.0) -> void :
	if bgm_fade_tween and bgm_fade_tween.is_running():
		return
	if bgm_fade_tween:
		bgm_fade_tween.kill()

	bgm_fade_tween = create_tween()
	bgm_fade_tween.tween_property(
		AudioManager.bgm_player, 
		"volume_db", 
		-80.0, 
		duration
	)




func _on_level_signal_dead(_dead_param) -> void :
	if not is_active_boss or boss_disabled:
		return
	if is_player_killed or (bgm_fade_tween and bgm_fade_tween.is_running()):
		return
	start_bgm_fade_out(5.0)




func final_attack() -> void :
	if not is_active_boss or boss_disabled:
		return
	if is_player_killed:
		return
	if current_state in [BossState.Dead, BossState.Disable]:
		return
	_stop_all_behaviors()
	final_attack_mode = true
	boss_attack(ActionType.AttackDown)




func active_Boss() -> void :
	GameData.bpm = bpm


	AudioManager.restart_scheduled_bgm(bgm_stream, 0.0)
	is_active_boss = true
	change_state(BossState.Show)
	player.attack_active_frame_start = 0




func electric_hurt() -> void :
	if not is_active_boss or boss_disabled:
		return
	if current_state in [BossState.Dead, BossState.Disable]:
		return
	if current_state == BossState.Electric_Hurt:
		return

	signal_boss_hurt.emit(3)
	set_super_armor(false)
	_stop_all_behaviors()

	if current_state == BossState.Hurt:
		current_state = BossState.Electric_Hurt
		animated_sprite_2d.play("ElectricHurt")
	else:
		change_state(BossState.Electric_Hurt)

	hurt_timer = electric_hurt_duration




func second_phase():
	is_second_phase = true



func boss_dead() -> void :
	if current_state in [BossState.Dead, BossState.Disable]:
		return

	_stop_all_behaviors()
	set_super_armor(false)
	hurt_box.set_deferred("monitoring", false)
	final_attack_mode = false
	is_updated_action = false
	change_state(BossState.Dead)
