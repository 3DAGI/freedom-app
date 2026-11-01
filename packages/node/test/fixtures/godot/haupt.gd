extends ColorRect


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		color = Color(0.752941, 0, 0, 1)
