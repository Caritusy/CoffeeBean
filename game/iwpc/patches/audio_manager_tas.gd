extends Node

@onready var bgm_player: AudioStreamPlayer = $BGMPlayer
@onready var main_menu_bgm_player: AudioStreamPlayer = $MainMenuBGMPlayer

const POOL_SIZE: = 20
var sfx_players: Array[AudioStreamPlayer] = []
var pool_index: = 0
var extra_players: Array[AudioStreamPlayer] = []

const BGM_RESTART_SYNC_WINDOW_SEC: = 0.75
const BGM_RESTART_STALE_TOLERANCE_SEC: = 0.25
var _scheduled_bgm_stream: AudioStream = null
var _scheduled_bgm_started_at_usec: int = -1
var _scheduled_bgm_start_offset: float = 0.0

var _tas_fast_forwarding: bool = false
var _tas_anchor_stream: AudioStream = null
var _tas_anchor_bgm_time: float = 0.0
var _tas_anchor_clock_time: float = 0.0
var _tas_last_bgm_time: float = 0.0
var _tas_last_real_position: float = 0.0
var _tas_bgm_was_paused: bool = false
var _tas_audio_suspended: bool = false


func _ready():
	_init_audio_buses()
	_init_sfx_pool()


func _init_audio_buses():
	if AudioServer.get_bus_index("BGM") == -1:
		print("[AudioManager] Warning: BGM bus missing -> fallback to Master")
		bgm_player.bus = "Master"
		main_menu_bgm_player.bus = "Master"
	else:
		bgm_player.bus = "BGM"
		main_menu_bgm_player.bus = "BGM"

	if AudioServer.get_bus_index("SFX") == -1:
		print("[AudioManager] Warning: SFX bus missing -> fallback to Master")


func _init_sfx_pool():
	for i in POOL_SIZE:
		var player = AudioStreamPlayer.new()
		if AudioServer.get_bus_index("SFX") != -1:
			player.bus = "SFX"
		else:
			player.bus = "Master"
		add_child(player)
		sfx_players.append(player)


func _start_sfx(stream: AudioStream, pitch: float = 1.0) -> AudioStreamPlayer:
	var player = sfx_players[pool_index]
	pool_index = (pool_index + 1) % POOL_SIZE
	player.stream = stream
	player.pitch_scale = pitch
	player.stop()
	if AudioServer.get_bus_index(player.bus) == -1:
		player.bus = "Master"
	player.play()
	return player


func trigger_sfx(stream: AudioStream, bias_time: float = 0.0, pitch: float = 1.0) -> void:
	if bias_time < 0:
		await get_tree().create_timer(-bias_time).timeout
	_start_sfx(stream, pitch)


func trigger_sfx_now(stream: AudioStream, pitch: float = 1.0) -> AudioStreamPlayer:
	return _start_sfx(stream, pitch)


func adjust_bgm_volume(volume: float):
	volume = clamp(volume, 0.0, 1.0)
	var db = linear_to_db(volume)
	bgm_player.volume_db = db
	main_menu_bgm_player.volume_db = db


func adjust_sfx_volume(volume: float):
	volume = clamp(volume, 0.0, 1.0)
	var db = linear_to_db(volume)
	for player in sfx_players:
		player.volume_db = db


func linear_to_db(volume: float) -> float:
	if volume <= 0:
		return -80
	return 20 * log(volume) / log(10)


func register_extra_player(player: AudioStreamPlayer) -> void:
	if player and not extra_players.has(player):
		extra_players.append(player)
		if not player.tree_exiting.is_connected(_on_extra_player_exiting):
			player.tree_exiting.connect(_on_extra_player_exiting.bind(player))


func _on_extra_player_exiting(player: AudioStreamPlayer) -> void:
	unregister_extra_player(player)


func unregister_extra_player(player: AudioStreamPlayer) -> void:
	extra_players.erase(player)


func pause_extra_players() -> void:
	for i in range(extra_players.size() - 1, -1, -1):
		var player = extra_players[i]
		if is_instance_valid(player):
			player.stream_paused = true
		else:
			extra_players.remove_at(i)


func resume_extra_players() -> void:
	for i in range(extra_players.size() - 1, -1, -1):
		var player = extra_players[i]
		if is_instance_valid(player):
			player.stream_paused = false
		else:
			extra_players.remove_at(i)


var _base_bias: float = 0.045
var _bias_k: float = 0.3


func _coffee_bean():
	if not OS.has_feature("web"):
		return null
	return JavaScriptBridge.get_interface("__coffeeBean")


func _coffee_fast_forwarding() -> bool:
	var coffee = _coffee_bean()
	return coffee != null and bool(coffee.isFastForwarding())


func _coffee_clock_time() -> float:
	var coffee = _coffee_bean()
	if coffee == null:
		return 0.0
	return float(coffee.getClockTimeSeconds())


func _real_bgm_time() -> float:
	var t: float = bgm_player.get_playback_position()
	t += AudioServer.get_time_since_last_mix()
	t -= AudioServer.get_output_latency()
	if OS.has_feature("web"):
		t += GameData.web_audio_sync_bias
	return maxf(t, 0.0)


func _begin_tas_bgm_anchor(start_time: float = -1.0) -> void:
	var playback_position: float = maxf(bgm_player.get_playback_position(), 0.0)
	_tas_anchor_stream = bgm_player.stream
	if start_time >= 0.0:
		_tas_anchor_bgm_time = start_time
	else:
		# New tracks normally begin at zero. Quantizing their startup window keeps
		# browser audio-buffer latency out of beat selection.
		_tas_anchor_bgm_time = 0.0 if playback_position < 0.25 else playback_position
	_tas_anchor_clock_time = _coffee_clock_time()
	_tas_last_bgm_time = _tas_anchor_bgm_time
	_tas_last_real_position = playback_position


func _update_tas_bgm_time() -> void:
	if _tas_anchor_stream == null:
		return
	var elapsed: float = maxf(_coffee_clock_time() - _tas_anchor_clock_time, 0.0)
	_tas_last_bgm_time = _tas_anchor_bgm_time + elapsed


func _suspend_tas_audio() -> void:
	if _tas_audio_suspended:
		return
	_tas_bgm_was_paused = bgm_player.stream_paused
	bgm_player.stream_paused = true
	_tas_audio_suspended = true


func _clear_tas_bgm_anchor(seek_to_virtual: bool) -> void:
	if _tas_anchor_stream != null and bgm_player.stream == _tas_anchor_stream:
		_update_tas_bgm_time()
		if seek_to_virtual and bgm_player.playing:
			bgm_player.seek(maxf(_tas_last_bgm_time, 0.0))
	if _tas_audio_suspended:
		bgm_player.stream_paused = _tas_bgm_was_paused
	_tas_audio_suspended = false
	_tas_anchor_stream = null
	_tas_last_real_position = 0.0


func _process(_delta: float) -> void:
	if not OS.has_feature("web"):
		return

	var coffee = _coffee_bean()
	var fast_forwarding: bool = coffee != null and _coffee_fast_forwarding()
	var real_position: float = maxf(bgm_player.get_playback_position(), 0.0)
	if _tas_anchor_stream != null and (not bgm_player.playing or bgm_player.stream != _tas_anchor_stream):
		_clear_tas_bgm_anchor(false)
	if coffee != null and bgm_player.playing:
		# A backwards real position means the same stream was restarted. Stream
		# identity alone cannot detect stop/play on one AudioStream resource.
		if _tas_anchor_stream == null or real_position + 0.1 < _tas_last_real_position:
			_begin_tas_bgm_anchor()
		_update_tas_bgm_time()
		if fast_forwarding:
			_suspend_tas_audio()
		elif _tas_audio_suspended:
			bgm_player.seek(maxf(_tas_last_bgm_time, 0.0))
			bgm_player.stream_paused = _tas_bgm_was_paused
			_tas_audio_suspended = false
		_tas_last_real_position = real_position
	elif _tas_anchor_stream != null:
		_clear_tas_bgm_anchor(false)
	_tas_fast_forwarding = fast_forwarding

	var time_since_mix: float = AudioServer.get_time_since_last_mix()
	var output_latency: float = AudioServer.get_output_latency()
	var expected_mix_interval: float = 0.016
	var extra_delay: float = max(0.0, time_since_mix - expected_mix_interval)
	GameData.web_audio_sync_bias = _base_bias + output_latency + extra_delay * _bias_k


func get_bgm_time() -> float:
	if not bgm_player.playing:
		return 0.0
	# TAS playback and recording use the same fixed project clock. The browser
	# audio mixer can run behind during loading or shader compilation, so using
	# its position here changes beat phases without changing the input frame.
	if _coffee_bean() != null:
		return get_tas_bgm_time()
	return _real_bgm_time()


func get_tas_bgm_time() -> float:
	if not bgm_player.playing:
		return 0.0
	if _coffee_bean() == null:
		return _real_bgm_time()
	var real_position: float = maxf(bgm_player.get_playback_position(), 0.0)
	if _tas_anchor_stream == null or bgm_player.stream != _tas_anchor_stream or real_position + 0.1 < _tas_last_real_position:
		_begin_tas_bgm_anchor()
	_update_tas_bgm_time()
	_tas_last_real_position = real_position
	return _tas_last_bgm_time


func restart_scheduled_bgm(stream: AudioStream, from_position: float = 0.0) -> void:
	_clear_tas_bgm_anchor(false)
	bgm_player.stop()
	bgm_player.stream = stream
	bgm_player.play(from_position)
	_scheduled_bgm_stream = stream
	_scheduled_bgm_start_offset = maxf(from_position, 0.0)
	_scheduled_bgm_started_at_usec = Time.get_ticks_usec()
	if _coffee_bean() != null:
		_begin_tas_bgm_anchor(_scheduled_bgm_start_offset)


func get_bgm_schedule_time() -> float:
	if _coffee_bean() != null:
		return get_tas_bgm_time()
	var playback_time: = bgm_player.get_playback_position()
	if OS.has_feature("web"):
		playback_time += GameData.web_audio_sync_bias
	if (
		_scheduled_bgm_started_at_usec < 0
		or bgm_player.stream != _scheduled_bgm_stream
	):
		return playback_time

	var elapsed: = float(Time.get_ticks_usec() - _scheduled_bgm_started_at_usec) / 1000000.0
	if elapsed > BGM_RESTART_SYNC_WINDOW_SEC:
		_scheduled_bgm_started_at_usec = -1
		return playback_time

	var expected_max: = _scheduled_bgm_start_offset + elapsed + BGM_RESTART_STALE_TOLERANCE_SEC
	if playback_time > expected_max:
		return _scheduled_bgm_start_offset + elapsed
	return playback_time
