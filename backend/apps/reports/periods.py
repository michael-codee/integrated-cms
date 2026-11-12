import datetime


def _month_end(d):
    nxt = (d.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
    return nxt - datetime.timedelta(days=1)


def period_containing(frequency, day):
    if frequency == "monthly":
        start = day.replace(day=1)
        return start, _month_end(start)
    if frequency == "quarterly":
        start = day.replace(month=(day.month - 1) // 3 * 3 + 1, day=1)
        return start, _month_end(start.replace(month=start.month + 2))
    start = day.replace(month=1, day=1)
    return start, day.replace(month=12, day=31)


def previous_period(frequency, day):
    """The most recent period that has already ended on ``day``."""
    start, _ = period_containing(frequency, day)
    return period_containing(frequency, start - datetime.timedelta(days=1))


def recent_periods(frequency, day, count=12):
    out = []
    start, end = previous_period(frequency, day)
    for _ in range(count):
        out.append((start, end))
        start, end = period_containing(frequency, start - datetime.timedelta(days=1))
    return out


def label(frequency, start):
    if frequency == "monthly":
        return start.strftime("%B %Y")
    if frequency == "quarterly":
        return f"Q{(start.month - 1) // 3 + 1} {start.year}"
    return str(start.year)
