package ru.spasibo.app.ui.splash

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import ru.spasibo.app.R

private val SplashBackground = Color(0xFF243B09)
private val DecorStroke = Color(0x662D5016)
private val DecorLightStroke = Color(0x33FFFFFF)
private val DecorDot = Color(0x662D5016)
private val DecorSparkle = Color(0x552D5016)

/** Полноэкранный splash с декоративным фоном и пульсацией сердца. */
@Composable
fun HeartbeatSplashScreen(
    modifier: Modifier = Modifier,
) {
    val configuration = LocalConfiguration.current
    val heartSizeDp = (configuration.screenWidthDp.coerceAtMost(configuration.screenHeightDp) * 0.72f).dp

    val infiniteTransition = rememberInfiniteTransition(label = "heartbeat")
    val heartScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = 1_400
                1f at 0
                1.14f at 160 using FastOutSlowInEasing
                1f at 320 using FastOutSlowInEasing
                1.08f at 480 using FastOutSlowInEasing
                1f at 640 using FastOutSlowInEasing
                1f at 1_400
            },
            repeatMode = RepeatMode.Restart,
        ),
        label = "heartScale",
    )

    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawRect(SplashBackground)

            drawCircle(
                color = DecorStroke,
                radius = size.minDimension * 0.46f,
                center = Offset(size.width * 0.5f, size.height * 0.48f),
                style = Stroke(width = 3f),
            )

            drawCircle(
                color = DecorLightStroke,
                radius = size.minDimension * 0.32f,
                center = Offset(size.width * 0.5f, size.height * 0.46f),
                style = Stroke(width = 2f),
            )

            drawCircle(
                color = DecorStroke,
                radius = size.minDimension * 0.13f,
                center = Offset(size.width * 0.12f, size.height * 0.16f),
                style = Stroke(width = 2.5f),
            )

            drawHatchedCircle(
                center = Offset(size.width * 0.12f, size.height * 0.16f),
                radius = size.minDimension * 0.11f,
            )

            drawDotGrid(
                topLeft = Offset(size.width * 0.06f, size.height * 0.74f),
                columns = 6,
                rows = 5,
                spacing = size.minDimension * 0.024f,
            )

            drawSparkles(
                center = Offset(size.width * 0.86f, size.height * 0.78f),
                size = size.minDimension * 0.04f,
            )

            drawCircle(
                color = DecorStroke,
                radius = size.minDimension * 0.24f,
                center = Offset(size.width * 1.04f, size.height * 0.84f),
                style = Stroke(width = 2.5f),
            )
        }

        Image(
            painter = painterResource(R.drawable.ic_splash_heart),
            contentDescription = null,
            modifier = Modifier
                .size(heartSizeDp)
                .graphicsLayer {
                    scaleX = heartScale
                    scaleY = heartScale
                },
        )
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawHatchedCircle(
    center: Offset,
    radius: Float,
) {
    val step = radius / 4f
    var offset = -radius
    while (offset <= radius) {
        drawLine(
            color = DecorStroke,
            start = Offset(center.x + offset, center.y - radius),
            end = Offset(center.x + offset, center.y + radius),
            strokeWidth = 1.5f,
        )
        offset += step
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawDotGrid(
    topLeft: Offset,
    columns: Int,
    rows: Int,
    spacing: Float,
) {
    for (row in 0 until rows) {
        for (column in 0 until columns) {
            drawCircle(
                color = DecorDot,
                radius = spacing * 0.24f,
                center = Offset(
                    topLeft.x + column * spacing,
                    topLeft.y + row * spacing,
                ),
            )
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawSparkles(
    center: Offset,
    size: Float,
) {
    val offsets = listOf(
        Offset(-size * 1.6f, -size * 0.4f),
        Offset(size * 0.2f, -size * 1.5f),
        Offset(size * 1.4f, size * 0.2f),
        Offset(-size * 0.3f, size * 1.3f),
    )
    offsets.forEach { offset ->
        drawSparkle(center + offset, size)
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawSparkle(
    center: Offset,
    size: Float,
) {
    rotate(45f, center) {
        val path = Path().apply {
            moveTo(center.x, center.y - size)
            lineTo(center.x + size * 0.28f, center.y)
            lineTo(center.x, center.y + size)
            lineTo(center.x - size * 0.28f, center.y)
            close()
        }
        drawPath(path, DecorSparkle)
    }
}
