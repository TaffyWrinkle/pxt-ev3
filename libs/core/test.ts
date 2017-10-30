screen.clear()
screen.print("PXT!", 10, 30, Draw.Quad)

screen.drawRect(40, 40, 20, 10, Draw.Fill)
motors.setStatusLight(LightsPattern.Orange)

screen.heart.doubled().draw(100, 50, Draw.Double | Draw.Transparent)

sensors.buttonEnter.onEvent(ButtonEvent.Click, () => {
    screen.clear()
})

sensors.buttonLeft.onEvent(ButtonEvent.Click, () => {
    screen.drawRect(10, 70, 20, 10, Draw.Fill)
    motors.setStatusLight(LightsPattern.Red)
    screen.setFont(screen.microbitFont())
})

sensors.buttonRight.onEvent(ButtonEvent.Click, () => {
    screen.print("Right!", 10, 60)
})

sensors.buttonDown.onEvent(ButtonEvent.Click, () => {
    screen.print("Down! ", 10, 60)
})

sensors.buttonUp.onEvent(ButtonEvent.Click, () => {
    screen.print("Up!  ", 10, 60)
})


let num = 0

sensors.touchSensor1.onEvent(TouchSensorEvent.Bumped, () => {
    screen.print("Click!  " + num, 10, 60)
    num++
})

sensors.remoteButtonTopLeft.onEvent(ButtonEvent.Click, () => {
    screen.print("TOPLEFT " + num, 10, 60)
    num++
})

sensors.remoteButtonTopRight.onEvent(ButtonEvent.Down, () => {
    screen.print("TOPRIGH " + num, 10, 60)
    num++
})

loops.forever(() => {
    serial.writeDmesg()
    loops.pause(100)
})

/*
loops.forever(() => {
    let v = input.color.getColor()
    screen.print(10, 60, v + "   ")
    loops.pause(200)
})
*/
