var counter = 0;
const TIMESPENT_REGEXP = /\[?(\d+(?:\.\d+)?)(dm|m|дм|м|dh|h|дч|ч)?\]?$/;
const TIMEPLANNED_REGEXP = /^\((\d+(?:\.\d+)?)(dm|m|дм|м|dh|h|дч|ч)?\)/;

var siteName = window.location.hostname;
if (siteName.startsWith("www.")) {
    siteName = siteName.substring(4);
}

var _MS_PER_DAY = 1000 * 60 * 60 * 24;

// a and b are javascript Date objects
function dateDiffInDays(a, b) {
  // Discard the time and time-zone information.
  var utc1 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  var utc2 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());

  return Math.floor((utc2 - utc1) / _MS_PER_DAY);
}

// calculate ratio from today until given date
function calcAnnualRatio(until) {
    const year = until.slice(0,4)*1;
    const month = until.slice(4, 6)*1;
    const day = until.slice(6,8)*1;
    var untilDate = new Date(year, month, day);
    const diffInDays = dateDiffInDays(new Date(), untilDate);
    return diffInDays > 365 ? 1 : diffInDays / 365;
}

function calcAnnualHoursFromRecurringRule(recurRule, minutes) {
    // "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR,SU",
    const FREQ_MULTIPLIERS = {
        "WEEKLY": 52.17,
        "MONTHLY": 12,
        "DAILY": 365,
        "YEARLY": 1
    };
    const ruleAttributes = recurRule.split(';');
    var annualMultiplier = 1;
    for (var i = 0; i < ruleAttributes.length; i++) {
        var rule = ruleAttributes[i].split('=');
        switch (rule[0]) {
            case "FREQ":
                annualMultiplier *= FREQ_MULTIPLIERS[rule[1]];
                break;
            case "INTERVAL":
                annualMultiplier /= rule[1] * 1;
                break;
            case "BYDAY":
                const days = rule[1].split(',');
                annualMultiplier *= days.length;
                break;
            case "WKST":
                // BYDAY duplicate?
                break;
            case "UNTIL":
                annualMultiplier *= calcAnnualRatio(rule[1]);
                break;
            default:
                console.error(`Unknown rule: ${ruleAttributes[i]}`);
        }
    }
    return minutes * annualMultiplier;
}


function updateDescription(taskid, oldTitle, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', `//maxdone.micromiles.co/services/v1/tasks/${taskid}`);
    xhr.onload = function() {
        if (xhr.status === 200) {
            const task = JSON.parse(xhr.responseText);
            const timeSpent = extractTime(task.title, TIMESPENT_REGEXP)
            if (task.recurRule && timeSpent > 0) {
                counter++;
                var [completedTimes, cumTimeSpent, cleanNotes] = extractTimeSpent(task.notes);
                cumTimeSpent = cumTimeSpent*1 + extractTime(oldTitle, TIMESPENT_REGEXP)*1;
                var newNotes = `<p>[${++completedTimes}/${cumTimeSpent}]</p>` + cleanNotes;
                updateTaskField(taskid, 'notes', newNotes, cb);
            }
        }
    }
    xhr.send();
}

function extractTimeSpent(notes) {
    if (notes && notes.startsWith('<p>[')) {
        const regx = /^(\<p\>).(\d+)\/(\d+)/;
        const matches = regx.exec(notes);
        if (matches.length == 4) {
            return [matches[2], matches[3], notes.slice(notes.indexOf(']</p>') + 5)];
        }
    }
    return [0, 0, notes];
}

function updateTitle(taskid, newTitle, oldTitle = null, cb = null) {
    var title = document.getElementById("taskPreviewTitle");
    if (title && title.value === oldTitle) {
        title.value = newTitle; // update on UI to avoid confusion
    }
    updateTaskField(taskid, 'title', newTitle, cb);
}

function updateTaskField(taskid, fieldName, fieldValue, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', `//maxdone.micromiles.co/services/v1/tasks/${taskid}/${fieldName}`);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.onload = function() {
        if (xhr.status !== 200) {
            console.error(`${fieldName} change failed: ${xhr.status}`);
        }
        if (cb) cb();
    };
    xhr.send(fieldValue);
}

function startTimer(taskid, myElem) {
    var startedAt = {};
    startedAt[taskid] = Date.now();
    chrome.storage.local.set(startedAt);
    myElem.parentElement.classList.toggle('highlightedRow');

}

function stopTimer(taskid, myElem) {
    chrome.storage.local.get(taskid, function(result) {
        const timeElapsed = Date.now() - result[taskid];
        var oldTitle = myElem.nextElementSibling.getAttribute("title");
        const newTitle = addTimeToTitle(oldTitle, timeElapsed)
        myElem.nextElementSibling.setAttribute("title", newTitle);
        myElem.parentElement.classList.toggle('highlightedRow');
        updateTitle(taskid, newTitle, oldTitle);
    });
}

function extractTime(taskTitle, taskDurationRegexp) {
    var matchResult = taskDurationRegexp.exec(taskTitle);
    var minutes = 0;
    if (matchResult) {
        var numPart = matchResult[1];
        if (numPart == "05") {
            numPart = "0.5";
        }
        minutes = parseFloat(numPart);
        var unit = matchResult[2];
        if (typeof unit == "undefined" || "hч".indexOf(unit) != -1) {
            minutes *= 60;
        }
    }
    return minutes;
}

// add time spent on task to end of task title
function addTimeToTitle(title, timeInMs) {
    const oldTimeSpent = extractTime(title, TIMESPENT_REGEXP);
    if (oldTimeSpent>0) {
        // add time to existing time
        const newTimeSpent = oldTimeSpent + Math.round(timeInMs / 60000);
        title = `${title.slice(0, title.lastIndexOf('[')-1)} [${prettyMinutes(newTimeSpent)}]`;
    } else {
        // just add time in minutes to task title
        title += ` [${prettyMinutes(Math.round(timeInMs/60000))}]`;
    }
    return title;
}

// convert minutes to human friendly form of XXч YYм
function prettyMinutes(mins, hours = false) {
    var minutesHTML = '';
    const minutes = Math.round(mins);
    var mm = hours ? minutes % 60 : minutes;
    if (hours) {
        var hh = (minutes - mm) / 60;
        if (hh > 0) {
            minutesHTML += hh + "ч";
        }
    }
    if (mm > 0) {
        if (hh > 0) {
            minutesHTML += " ";
        }
        minutesHTML += mm + "м";
    }
    return minutesHTML;
}

function rebuildChevrons(highlightedTasks, options) {
    var taskRowInfoBlocks = document.getElementsByClassName("taskRowInfoBlock");

    var todayMinutes = 0;
    var weekMinutes = 0;
    var laterMinutes = 0;
    var completedPlannedMinutes = 0;
    var completedActualMinutes = 0;

    for (var i = 0; i < taskRowInfoBlocks.length; i++) {
        var root = taskRowInfoBlocks[i];

        // construct chevron div
        var chevronElem = root.firstElementChild;
        var taskElem;
        if (!chevronElem.classList.contains("taskChevron")) {
            var day = "";
            taskElem = root.firstElementChild;
            var dateElem = taskElem.nextElementSibling.firstElementChild;
            if (dateElem && dateElem.classList.contains("date")) {
                var dateVal = dateElem.innerText;
                if (dateVal) {
                    // Trim time part
                    dateVal = dateVal.replace(/ @ .*/, '')
                }
                var today = new Date();
                today.setHours(0);
                today.setMinutes(0);
                today.setSeconds(0);
                today.setMilliseconds(0);
                var date;
                if (dateVal == "сегодня") {
                    date = today;
                } else if (dateVal == "вчера") {
                    if (options.overdueToday) {
                        date = today;
                    } else {
                        date = today;
                        date.setDate(date.getDate() - 1);
                    }
                } else if (dateVal == "завтра") {
                    date = today;
                    date.setDate(date.getDate() + 1);
                } else {
                    var dateSegments = dateVal.split("/");
                    date = new Date();
                    date.setFullYear(dateSegments[2]);
                    date.setHours(0);
                    date.setMinutes(0);
                    date.setSeconds(0);
                    date.setMilliseconds(0);
                    date.setMonth(dateSegments[1] - 1, dateSegments[0]);
                    if (options.overdueToday && date < today) {
                        date = today;
                    }
                }
                day = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"][date
                    .getDay()
                ];
            }

            chevronElem = document.createElement('div');
            chevronElem.className = "taskChevron";
            chevronElem.rootClassName = root.className;
            root.insertBefore(chevronElem, taskElem);
            var taskHighlighter = document.createElement('div');
            taskHighlighter.className = "taskHighlighter";
            taskHighlighter.addEventListener("mouseenter", function(e) {
                e.target.className = 'taskHighlighter-on';
            });
            taskHighlighter.addEventListener("mouseleave", function(e) {
                e.target.className = 'taskHighlighter';
            });
            taskHighlighter.addEventListener("click", function(e) {
                var myElem = e.target;
                var taskid = myElem.nextElementSibling.nextElementSibling
                    .getAttribute("taskid");
                if (highlightedTasks[taskid] == "YELLOW") {
                    highlightedTasks[taskid] = "NO";
                    if (options.activeTaskTimer) stopTimer(taskid, myElem.nextElementSibling);
                } else {
                    highlightedTasks[taskid] = "YELLOW";
                    if (options.activeTaskTimer) startTimer(taskid, myElem);
                }
            });
            taskHighlighter.innerText = "☻";
            root.insertBefore(taskHighlighter, taskElem);

            var dayInfoElem = document.createElement('div');
            dayInfoElem.className = "dayInfoElem";
            dayInfoElem.addEventListener("mouseenter", function(e) {
                e.target.className = 'dayInfoElem-on';
            });
            dayInfoElem.addEventListener("mouseleave", function(e) {
                e.target.className = 'dayInfoElem';
            });
            dayInfoElem.addEventListener("click", function(e) {
                var myElem = e.target;
                var taskid = myElem.nextElementSibling.getAttribute("taskid");
                if (highlightedTasks[taskid] == "YELLOW") {
                    highlightedTasks[taskid] = "NO";
                    if (options.activeTaskTimer) stopTimer(taskid, myElem);
                } else {
                    highlightedTasks[taskid] = "YELLOW";
                    if (options.activeTaskTimer) startTimer(taskid, myElem);
                }
            });
            if (day) dayInfoElem.innerText = day;
            root.insertBefore(dayInfoElem, taskElem);
        } else {
            taskElem = root.firstElementChild.nextElementSibling.nextElementSibling.nextElementSibling;
        }

        // reflect right color in chevron div
        var bottomElems = root.lastElementChild.children;
        var category = null;
        for (var k = 0; k < bottomElems.length; k++) {
            var bottomElem = bottomElems[k];
            if (bottomElem.classList.contains("project-label")) {
                category = bottomElem.innerText.replace(/[ ,.#{}!?:\/]/g, "-");
                // bottomElem.classList.add("project-" + projectLabel);
                break;
            }
        }
        root.className = chevronElem.rootClassName + " taskBlock-" + category +
            " ";
        if (highlightedTasks[taskElem.getAttribute("taskid")] == "YELLOW") {
            root.classList.add('highlightedRow');
        } else if (highlightedTasks[taskElem.getAttribute("taskid")] == "GREEN") {
            root.classList.add('highlightedRow2');
        }

        // transform into <b>
        var taskTitle = taskElem.title;
        var taskId = taskElem.getAttribute("taskid");

        var justWrapped = false;
        var tokens = taskTitle.split("*");
        if (tokens.length > 1) {
            for (var k = 0; k < tokens.length; k++) {
                if (!justWrapped && tokens[k].length > 0 &&
                    tokens[k].trim() == tokens[k]) {
                    tokens[k] = "<span class=\"emphasizedTextInTitle\">" +
                        tokens[k] + "</span>";
                    justWrapped = true;
                } else {
                    justWrapped = false;
                }
                taskElem.innerHTML = tokens.join("*");
            }
        } else {
            taskElem.innerHTML = taskTitle;
        }

        // count week hours
        var section = root.parentElement.parentElement.parentElement;
        if (taskTitle.startsWith("(")) {
            var minutes = extractTime(taskTitle, TIMEPLANNED_REGEXP);
            // TODO: insrert calcAnnualHoursFromRecurringRule
            if (minutes > 0) {
                if (section.id == "todayContent") {
                    todayMinutes += minutes;
                } else if (section.id == "weekContent") {
                    weekMinutes += minutes;
                } else if (section.id == "laterContent") {
                    laterMinutes += minutes;
                } else if (section.id == "completedContent") {
                    completedPlannedMinutes += minutes;
                }
            }
        }
        const timeSpent = extractTime(taskTitle, TIMESPENT_REGEXP);
        if (timeSpent>0) {
            if (section.id === "completedContent") {
                // count actual hours for completed tasks
                completedActualMinutes += extractTime(taskTitle, TIMESPENT_REGEXP);
            } else if (options.activeTaskTimer && (section.id === "weekContent" || section.id === "laterContent")) {
                // remove timeSpent from task title
                // console.log('weekContent task with actual time detected');
                // console.log(`section.id=${section.id} timeSpent=${timeSpent}`);
                updateTitle(taskId, taskTitle.slice(0, taskTitle.lastIndexOf(' ')));
            }
        }
    }

    // console.log("RESULT: " + (todayMinutes / 60) + " -- "
    // + (weekMinutes / 60) + " -- " + (laterMinutes / 60));
    updateHours("todayHeader", todayMinutes > 0 ? `запланировано: ${prettyMinutes(todayMinutes, true)}` : '');
    updateHours("weekHeader", `запланировано: ${prettyMinutes(weekMinutes, true)}`);
    updateHours("laterHeader", `запланировано: ${prettyMinutes(laterMinutes, true)}`);
    var completedSubtotal = `запланированных: ${prettyMinutes(completedPlannedMinutes, true)} `;
    if (options.activeTaskTimer) completedSubtotal += ` -- фактически: ${prettyMinutes(completedActualMinutes, true)}`;
    updateHours("completedHeader", completedSubtotal);

}

function updateHours(headerId, title) {
    var headerEl = document.getElementById(headerId);
    if (headerEl != null) {
        var lastElem = headerEl.lastElementChild;
        var hoursElemId = headerId + "-HoursEl";
        var minutesHTML = `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; -- ${title}`;
        var hoursEl = lastElem.lastElementChild;
        if (hoursEl.id == hoursElemId) {
            hoursEl.innerHTML = minutesHTML;
        } else {
            hoursEl = document.createElement("span");
            hoursEl.id = hoursElemId;
            hoursEl.innerHTML = minutesHTML;
            lastElem.appendChild(hoursEl);
        }
    }
}

if (siteName == "maxdone.micromiles.co") {
    var mainContainer = document.getElementById("mainContainer");
    if (!mainContainer.observingChanges) {
        mainContainer.observingChanges = true;

        // Use default value overdueToday = true.
        chrome.storage.sync.get({
            overdueToday: true,
            activeTaskTimer: false
        }, function(options) {
            setupObserver(options);
        });
    }
}

function setupObserver(options) {
    var highlightedTasks = [];
    rebuildChevrons(highlightedTasks, options);

    var scheduled = false;
    var observer = new MutationObserver(function(mutations) {
        if (!scheduled) {
            scheduled = true;
            setTimeout(function() {
                scheduled = false;
                observer.disconnect();
                rebuildChevrons(highlightedTasks, options);
                observer.observe(mainContainer, {
                    childList: true,
                    subtree: true
                });
            }, 100);
        }
    });
    observer.observe(mainContainer, {
        childList: true,
        subtree: true
    });
}

/*
 http://stackoverflow.com/questions/25335648/how-to-intercept-all-ajax-requests-made-by-different-js-libraries
 */

// (function(open) {
//     console.log("Within!");
//
//     XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
//         console.log("Before calling.." + method + " " + url);
//
//         this.addEventListener("readystatechange", function() {
//             console.log(this.readyState); // this one I changed
//         }, false);
//
//         open.call(this, method, url, async, user, pass);
//     };
//     console.log("Done!");
// })(XMLHttpRequest.prototype.open);
//
//
// function doCall123456() {
//     var x = new XMLHttpRequest();
//     x.open("POST",
//         "https://maxdone.micromiles.co/services/v1/tasks");
//     x.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
//     var
//         data = JSON.stringify({
//             "project": false,
//             "allDay": true,
//             "path": "",
//             "childrenIds": [],
//             "title": "QWERTY !!!",
//             "userId": "",
//             "goalId": null,
//             "goalTenantId": null,
//             "goalMilestoneId": "",
//             "delegatedTargetUserId": "",
//             "delegatedTargetTaskId": "",
//             "delegatedSourceTaskId": "",
//             "contextId": "",
//             "dueDate": "",
//             "startDatetime": "",
//             "notes": "",
//             "recurRule": null,
//             "recurChildId": "",
//             "recurParentId": "",
//             "done": false,
//             "taskType": "TODAY",
//             "calculatedTaskType": "INBOX",
//             "completionDate": "",
//             "timeZone": "America/New_York",
//             "checklistItems": [],
//             "priority": "56",
//             "hideUntilDate": null,
//             "state": "ACTIVE"
//         });
//     x.send(data);
//
//     window.alert(x);
//
//     if (x.status == 200) {
//         window.alert(x.status + "\n" + x.responseText);
//     } else {
//         window.alert(x.status + "\n" + x.statusText);
//     }
// }
//
// //doCall123456();
