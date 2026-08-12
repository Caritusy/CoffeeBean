extends Node

const BRICK := Color(0.18, 0.55, 1.0, 0.92)
const LETHAL := Color(1.0, 0.16, 0.12, 0.96)
const PLAYER := Color(0.20, 1.0, 0.36, 0.96)
const INTERACTABLE := Color(0.78, 0.22, 1.0, 0.96)
const ATTACK := Color(0.04, 0.04, 0.04, 1.0)
const LINE_WIDTH := 2.5

var _shape_entries: Array[Dictionary] = []
var _polygon_entries: Array[Dictionary] = []

func _ready() -> void:
    get_tree().node_added.connect(_on_node_added)
    call_deferred("_scan_existing")

func _physics_process(_delta: float) -> void:
    _sync_shapes()
    _sync_polygons()

func _scan_existing() -> void:
    _scan(get_tree().root)

func _scan(node: Node) -> void:
    _configure(node)
    for child in node.get_children():
        _scan(child)

func _on_node_added(node: Node) -> void:
    if node is CollisionShape2D or node is CollisionPolygon2D:
        _configure.call_deferred(node)

func _configure(node: Node) -> void:
    if not is_instance_valid(node) or not node.is_inside_tree() or node.has_meta("coffeebean_hitbox"):
        return
    if node is CollisionShape2D:
        _add_shape_outline(node)
    elif node is CollisionPolygon2D:
        _add_polygon_outline(node)

func _add_shape_outline(collision: CollisionShape2D) -> void:
    if collision.shape == null:
        return
    var kind := _kind(collision)
    if kind == "brick":
        collision.set_meta("coffeebean_hitbox", true)
        return
    var color := _color(kind)
    collision.debug_color = color
    var lines: Array[Line2D] = []
    var shape: Shape2D = collision.shape
    if shape is RectangleShape2D:
        var half: Vector2 = shape.size * 0.5
        lines.append(_make_line(PackedVector2Array([
            Vector2(-half.x, -half.y), Vector2(half.x, -half.y),
            Vector2(half.x, half.y), Vector2(-half.x, half.y)
        ]), color, true))
    elif shape is CircleShape2D:
        lines.append(_make_line(_circle_points(shape.radius, 28), color, true))
    elif shape is CapsuleShape2D:
        lines.append(_make_line(_capsule_points(shape.radius, shape.height, 20), color, true))
    elif shape is ConvexPolygonShape2D:
        lines.append(_make_line(shape.points, color, true))
    elif shape is ConcavePolygonShape2D:
        var segments: PackedVector2Array = shape.segments
        for index in range(0, segments.size() - 1, 2):
            lines.append(_make_line(PackedVector2Array([segments[index], segments[index + 1]]), color, false))
    elif shape is SegmentShape2D:
        lines.append(_make_line(PackedVector2Array([shape.a, shape.b]), color, false))
    else:
        var rect := shape.get_rect()
        lines.append(_make_line(PackedVector2Array([
            rect.position, rect.position + Vector2(rect.size.x, 0.0),
            rect.position + rect.size, rect.position + Vector2(0.0, rect.size.y)
        ]), color, true))
    if lines.is_empty():
        return
    for line in lines:
        if kind == "attack" and collision.get_parent() is Node2D:
            collision.get_parent().add_child(line)
            line.transform = collision.transform
        else:
            collision.add_child(line)
    collision.set_meta("coffeebean_hitbox", true)
    _shape_entries.append({"collision": collision, "lines": lines, "kind": kind})

func _add_polygon_outline(polygon: CollisionPolygon2D) -> void:
    if polygon.polygon.size() < 2:
        return
    var kind := _kind(polygon)
    if kind == "brick":
        polygon.set_meta("coffeebean_hitbox", true)
        return
    var line := _make_line(polygon.polygon, _color(kind), true)
    if kind == "attack" and polygon.get_parent() is Node2D:
        polygon.get_parent().add_child(line)
        line.transform = polygon.transform
    else:
        polygon.add_child(line)
    polygon.set_meta("coffeebean_hitbox", true)
    _polygon_entries.append({
        "collision": polygon,
        "line": line,
        "points": polygon.polygon,
        "kind": kind,
        "direction": _attack_direction(polygon, 1)
    })

func _sync_shapes() -> void:
    for index in range(_shape_entries.size() - 1, -1, -1):
        var entry := _shape_entries[index]
        var collision = entry.collision
        if not is_instance_valid(collision):
            _shape_entries.remove_at(index)
            continue
        for line in entry.lines:
            if is_instance_valid(line):
                line.visible = true
                if entry.kind == "attack" and line.get_parent() != collision:
                    entry.direction = _attack_direction(collision, entry.get("direction", 1))
                    line.transform = _attack_transform(collision.transform, entry.direction)

func _sync_polygons() -> void:
    for index in range(_polygon_entries.size() - 1, -1, -1):
        var entry := _polygon_entries[index]
        var collision = entry.collision
        var line = entry.line
        if not is_instance_valid(collision) or not is_instance_valid(line):
            _polygon_entries.remove_at(index)
            continue
        line.visible = true
        if entry.kind == "attack" and line.get_parent() != collision:
            entry.direction = _attack_direction(collision, entry.direction)
            line.transform = _attack_transform(collision.transform, entry.direction)
        if entry.points != collision.polygon:
            line.points = collision.polygon
            entry.points = collision.polygon

func _attack_direction(collision: Node, fallback: int) -> int:
    var player := collision.get_parent()
    while player != null and player.name != "Player":
        player = player.get_parent()
    if player == null:
        return fallback
    var left := player.get_node_or_null("AnimatedSprite2D_Left") as CanvasItem
    var right := player.get_node_or_null("AnimatedSprite2D_Right") as CanvasItem
    if left != null and left.visible and (right == null or not right.visible):
        return -1
    if right != null and right.visible and (left == null or not left.visible):
        return 1
    return fallback

func _attack_transform(source: Transform2D, direction: int) -> Transform2D:
    if direction >= 0:
        return source
    return Transform2D(
        Vector2(-source.x.x, source.x.y),
        Vector2(-source.y.x, source.y.y),
        Vector2(-source.origin.x, source.origin.y)
    )

func _make_line(points: PackedVector2Array, color: Color, closed: bool) -> Line2D:
    var line := Line2D.new()
    line.name = "CoffeeBeanHitboxOutline"
    line.points = points
    line.closed = closed
    line.width = LINE_WIDTH
    line.default_color = color
    line.antialiased = true
    line.z_index = RenderingServer.CANVAS_ITEM_Z_MAX
    line.show_behind_parent = false
    return line

func _kind(node: Node) -> String:
    var path := str(node.get_path()).to_lower()
    if path.contains("/player/attackhitbox"):
        return "attack"
    if _has_any(path, ["/player/", "/player"]):
        return "player"
    if _has_any(path, [
        "killzone", "death", "bullet", "laser", "spike", "attackarea", "attackbox", "hurtbox", "boss",
        "\u5c16\u523a", "\u6b7b\u4ea1\u533a\u57df", "\u5b50\u5f39", "\u6fc0\u5149",
        "\u5730\u96f7", "\u526a\u5200", "\u98de\u8e22"
    ]):
        return "lethal"
    if _has_any(path, [
        "switch", "lever", "button", "checkpoint", "detectarea", "trigger", "interact", "portal", "showblock",
        "\u5f00\u5173", "\u6447\u6746", "\u6309\u94ae", "\u4f20\u9001\u70b9",
        "\u68c0\u67e5\u70b9", "\u89e6\u53d1"
    ]):
        return "interactable"
    return "brick"

func _has_any(value: String, terms: Array[String]) -> bool:
    for term in terms:
        if value.contains(term):
            return true
    return false

func _color(kind: String) -> Color:
    match kind:
        "attack": return ATTACK
        "player": return PLAYER
        "lethal": return LETHAL
        "interactable": return INTERACTABLE
        _: return BRICK

func _circle_points(radius: float, count: int) -> PackedVector2Array:
    var points := PackedVector2Array()
    for index in count:
        var angle := TAU * float(index) / float(count)
        points.append(Vector2(cos(angle), sin(angle)) * radius)
    return points

func _capsule_points(radius: float, height: float, count: int) -> PackedVector2Array:
    var points := PackedVector2Array()
    var half_segment := maxf(height * 0.5 - radius, 0.0)
    for index in count + 1:
        var angle := PI * float(index) / float(count)
        points.append(Vector2(cos(angle) * radius, -half_segment + sin(angle) * radius))
    for index in count + 1:
        var angle := PI + PI * float(index) / float(count)
        points.append(Vector2(cos(angle) * radius, half_segment + sin(angle) * radius))
    return points
