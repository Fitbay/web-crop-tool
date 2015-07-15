define([
    "jquery",
    "marionette"
], function ($, Marionette) {

    "use strict";

    var MINIMUM_CROP_WIDTH = 250,
        MINIMUM_CROP_HEIGHT = 250;

    var CropTool = Marionette.Object.extend({

        /**
         *  Options:
         *  `image` (`imageSelector`|required): jQuery object of the image
         *  `imageSelector` (`image`|required): jQuery selector for the image
         *  `imageWidth` (required): original width of the image
         *  `imageHeight` (required): original height of the image
         *  `context` (optional): context to find the image in
         *  `ratio` (optional): width / height, leave empty for no ratio
         *  `minWidth` (optional): minimum width of cropped image
         *  `minHeight` (optional): minimum height of cropped image
         *  `initialCoordinates` (optional): initial tracker coordinates
         */
        initialize: function (options) {
            options = options || {};

            //Check for image or image selector option
            if (options.image) {
                this.image = options.image;
            }
            else if (options.imageSelector) {
                //Check for context option, or choose global
                var context = options.context || $;
                //Find image in DOM
                this.image = context.find(options.imageSelector);
            }
            else {
                throw new Error("`image` or `imageSelector` are required.");
            }

            //Check for original image dimension options
            if (!options.imageWidth || !options.imageHeight) {
                throw new Error("`imageWidth` and `imageHeight` are required.");
            }
            this.fullWidth = options.imageWidth;
            this.fullHeight = options.imageHeight;

            //Check for minimum crop dimension options, or choose defaults
            this.minWidth = options.minWidth || MINIMUM_CROP_WIDTH;
            this.minHeight = options.minHeight || MINIMUM_CROP_HEIGHT;

            //Check for initial coordinates
            if (options.initialCoordinates) {
                this.initialCoordinates = options.initialCoordinates;
                if (!this.initialCoordinates.hasOwnProperty("width")) {
                    throw new Error("Missing property `width` in coordinates");
                }
                if (!this.initialCoordinates.hasOwnProperty("height")) {
                    throw new Error("Missing property `height` in coordinates");
                }
                if (!this.initialCoordinates.hasOwnProperty("top")) {
                    throw new Error("Missing property `top` in coordinates");
                }
                if (!this.initialCoordinates.hasOwnProperty("left")) {
                    throw new Error("Missing property `left` in coordinates");
                }
            }

            //Check for ratio option or ignore
            if (options.ratio) {
                this.ratio = options.ratio;
            }

            //Find image in DOM
            if (this.image.length === 1) {
                //Require exactly one element
                if (this.image.width() && this.image.height()) {
                    //If image already loaded, just continue
                    this._doInitialize();
                }
                else {
                    //If image not loaded, wait for load
                    this.image.load($.proxy(function () {
                        this._doInitialize();
                    }, this));
                }
            }
        },

        _doInitialize: function () {
            //Wrap image element and creater tracker
            this._createElements();
            //Position tracker appropriately
            this._initiallyPositionTracker();

            //Listen for drag and resize events
            this._enableDragListener();
            this._enableResizeListener();

            //Inform that cropping is ready for use
            this.trigger("crop:ready");

            //Enable resize listener
            $(window).on("resize.crop", $.proxy(this._restartListeners, this));
        },

        onBeforeDestroy: function () {
            //Clean up listeners for drag and resize events
            this._disableDragListener();
            this._disableResizeListener();

            //Disable resize listener
            $(window).off("resize.crop");
        },

        _enableDragListener: function () {
            //Find the HTML element to improve attribute update performance
            var trackerElement = this.tracker.get(0);

            //Listen to event inside tracker area
            this.tracker.one("mousedown", $.proxy(function (e) {
                //Check for action on a corner dot
                if ($(e.target).hasClass("dot")) {
                    //If corner dot, don't start dragging
                    this._enableDragListener();
                    return false;
                }

                //Determine initial coords of tracker relative to mouse position
                var preOffset = this.tracker.position(),
                    preOffsetX = e.clientX - preOffset.left,
                    preOffsetY = e.clientY - preOffset.top,
                //Determine max offsets for tracker for current tracker area
                    maxOffsetX = this.imageWidth - this.tracker.outerWidth(),
                    maxOffsetY = this.imageHeight - this.tracker.outerHeight();

                //Listen to global events (to allow tracker to stick to border)
                $("body").on("mousemove", $.proxy(function (e) {
                    //Determine new x offset from mouse position
                    var newX = e.clientX - preOffsetX;
                    //Ensure offset of at least zero
                    if (newX < 0) {
                        newX = 0;
                    }
                    //Ensure tracker stays inside parent
                    else if (newX > maxOffsetX) {
                        newX = maxOffsetX;
                    }

                    //Determine new y offset from mouse position
                    var newY = e.clientY - preOffsetY;
                    //Ensure offset of at least zero
                    if (newY < 0) {
                        newY = 0;
                    }
                    //Ensure tracker stays inside parent
                    else if (newY > maxOffsetY) {
                        newY = maxOffsetY;
                    }

                    //Modify HTML element directly for performance
                    trackerElement.style.top = newY + "px";
                    trackerElement.style.left = newX + "px";

                    //Inform that selected area is moved
                    this.trigger("crop:moved", this.getCoords());
                }, this));

                //Listen to global events (to catch mouseup outside of element)
                $("body").one("mouseup", $.proxy(this._handleMouseUp, this));
            }, this));
        },
        _disableDragListener: function () {
            if (this.tracker) {
                //Disable initial drag listener
                this.tracker.off("mousedown");
            }
            //Disable possibly active mouse move event
            $("body").off("mousemove");
        },

        _enableResizeListener: function () {
            //Find the HTML element to improve attribute update performance
            var trackerElement = this.tracker.get(0);

            //Listen to events on any corner dot
            this.corners.one("mousedown", $.proxy(function (e) {
                //Determine which corner we are dealing with
                var dot = $(e.currentTarget),
                    isNorth = dot.hasClass("ext-nw") || dot.hasClass("ext-ne"),
                    isWest = dot.hasClass("ext-nw") || dot.hasClass("ext-sw");
                //Determine initial coords of tracker relative to mouse position
                var preClientX = e.clientX,
                    preClientY = e.clientY,
                    preWidth = this.tracker.outerWidth(),
                    preHeight = this.tracker.outerHeight(),
                    preOffset = this.tracker.position(),
                    preOffsetX = preClientX - preOffset.left,
                    preOffsetY = preClientY - preOffset.top,
                    preOffsetWidth = preClientX - preWidth,
                    preOffsetHeight = preClientY - preHeight,
                    preRight,
                    preBottom;
                //Calculate initial right and bottom based on coords
                if (this.ratio) {
                    preRight = this.imageWidth - preWidth - preOffset.left;
                    preBottom = this.imageHeight - preHeight - preOffset.top;
                }

                //Listen to global events (to allow tracker to stick to border)
                $("body").on("mousemove", $.proxy(function (e) {
                    //Set defaults and initiate values
                    var top = preOffset.top,
                        right = "auto",
                        bottom = "auto",
                        left = preOffset.left,
                        width,
                        height,
                        maxWidth,
                        maxHeight;

                    //Handle ratio based resizing
                    if (this.ratio) {
                        if (isNorth) {
                            //Set top offset to default
                            top = "auto";
                            //Set bottom offset calculated from top and height
                            bottom = preBottom;
                            //Set max height to image height minus offset
                            maxHeight = this.imageHeight - preBottom;
                        }
                        else {
                            //Set max height to image height minus offset
                            maxHeight = this.imageHeight - preOffset.top;
                        }
                        if (isWest) {
                            //Set left offset to default
                            left = "auto";
                            //Set right offset calculated from left and width
                            right = preRight;
                            //Set max width to image width minus offset
                            maxWidth = this.imageWidth - preRight;
                            //Set width to previous width minus moved distance
                            width = preWidth - (e.clientX - preClientX);
                        }
                        else {
                            //Set max width to image width minus offset
                            maxWidth = this.imageWidth - preOffset.left;
                            //Determine new width from mouse position
                            width = e.clientX - preOffsetWidth;
                        }

                        //Check for width being smaller than minimum width
                        if (width < this.imageMinWidth) {
                            //Set width to minimum width
                            width = this.imageMinWidth;
                        }
                        //Check for width being higher than maximum width
                        if (width > maxWidth) {
                            //Set width to maximum width
                            width = maxWidth;
                        }
                        //Set height based on ratio relative to width
                        height = width / this.ratio;

                        //Check for height being smaller than minimum height
                        if (height < this.imageMinHeight) {
                            //Set height to minimum height
                            height = this.imageMinHeight;
                        }
                        //Check for height being higher than maximum height
                        if (height > maxHeight) {
                            //Set height to maximum height
                            height = maxHeight;
                        }

                        //Set width based on ratio relative to height
                        width = height * this.ratio;
                    }
                    //Handle unrestricted resizing
                    else {
                        //Check for nw, ne or sw corners
                        var offset;
                        if (isNorth || isWest) {
                            //Pre-get tracker position this if needed
                            offset = this.tracker.position();
                        }

                        //Check for nw or sw corners
                        if (isWest) {
                            //Determine new x offset from mouse position
                            left = e.clientX - preOffsetX;
                            //Ensure offset of at least zero
                            if (left < 0) {
                                left = 0;
                            }

                            //Update width to add/subtract offset difference
                            width = this.tracker.outerWidth() + (offset.left - left);

                            //Set max width to image width minus offset
                            maxWidth = this.imageWidth - left;
                        }
                        //Otherwise ne or se corners
                        else {
                            //Determine new width from mouse position
                            width = e.clientX - preOffsetWidth;

                            //Set max width to image width minus offset
                            maxWidth = this.imageWidth - preOffset.left;
                        }
                        //Check for width being smaller than minimum width
                        if (width < this.imageMinWidth) {
                            //Check for nw or sw corners
                            if (isWest) {
                                //Update offset to add/subtract width difference
                                left += width - this.imageMinWidth;
                            }

                            //Set width to minimum width
                            width = this.imageMinWidth;
                        }
                        //Check for width being higher than maximum width
                        if (width > maxWidth) {
                            //Set width to maximum width
                            width = maxWidth;
                        }

                        //Check for nw or ne corners
                        if (isNorth) {
                            //Determine new y offset from mouse position
                            top = e.clientY - preOffsetY;
                            //Ensure offset of at least zero
                            if (top < 0) {
                                top = 0;
                            }

                            //Update height to add/subtract offset difference
                            height = this.tracker.outerHeight() + (offset.top - top);

                            //Set max height to image width minus offset
                            maxHeight = this.imageHeight - top;
                        }
                        //Otherwise se or sw corners
                        else {
                            //Determine new height from mouse position
                            height = e.clientY - preOffsetHeight;

                            //Set max height to image width minus offset
                            maxHeight = this.imageHeight - preOffset.top;
                        }
                        //Check for height being smaller than minimum height
                        if (height < this.imageMinHeight) {
                            //Check for nw or ne corners
                            if (isNorth) {
                                //Update offset to add/subtract height difference
                                top += height - this.imageMinHeight;
                            }

                            //Set height to minimum height
                            height = this.imageMinHeight;
                        }
                        //Check for height being higher than maximum height
                        if (height > maxHeight) {
                            //Set height to maximum height
                            height = maxHeight;
                        }
                    }

                    //Modify HTML element directly for performance
                    trackerElement.setAttribute("style",
                        "top:"+(top === "auto" ? top : top+"px")+";"+
                        "right:"+(right === "auto" ? right : right+"px")+";"+
                        "bottom:"+(bottom === "auto" ? bottom : bottom+"px")+";"+
                        "left:"+(left === "auto" ? left : left+"px")+";"+
                        "width:"+width+"px;"+
                        "height:"+height+"px;"
                    );

                    //Inform that selected area is moved
                    this.trigger("crop:moved", this.getCoords());
                }, this));

                //Listen to global events (to catch mouseup outside of element)
                $("body").one("mouseup", $.proxy(this._handleMouseUp, this));
            }, this));
        },
        _disableResizeListener: function () {
            if (this.corners) {
                //Disable initial resize listener
                this.corners.off("mousedown");
            }
            //Disable possibly active mouse move event
            $("body").off("mousemove");
        },

        _handleMouseUp: function () {
            this._restartListeners();

            //Inform that selected area is updated
            this.trigger("crop:changed", this.getCoords());
        },

        _restartListeners: function () {
            //Remove all active listeners
            this._disableDragListener();
            this._disableResizeListener();

            //Listen for drag and resize events
            this._enableDragListener();
            this._enableResizeListener();
        },

        _createElements: function () {
            //Wrap image element
            this.imageWrapper = $("<div></div>").css({
                display: "inline-block",
                position: "relative",
                width: this.image.outerWidth(),
                height: this.image.outerHeight()
            });
            this.imageWrapper.insertBefore(this.image);
            this.image.css("display", "block").appendTo(this.imageWrapper);

            //Save scaled image width and height
            this.imageWidth = this.image.outerWidth();
            this.imageHeight = this.image.outerHeight();

            //Save scaled minimum width and height
            var minWidth = this.imageWidth / this.fullWidth * this.minWidth,
                minHeight = this.imageHeight / this.fullHeight * this.minHeight;
            this.imageMinWidth = Math.ceil(minWidth);
            this.imageMinHeight = Math.ceil(minHeight);

            //Create tracker
            this.tracker = $("<div><span class=\"horiz-grid\"></span><span class=\"vert-grid\"></span></div>").attr("id", "tracker");
            //Add corner dots to tracker
            ["nw", "ne", "se", "sw"].forEach($.proxy(function (corner) {
                //Create corner dot
                var dot = $("<div></div>").attr("class", "dot ext-"+corner);
                //Insert corner into tracker
                dot.appendTo(this.tracker);
            }, this));
            //Save reference to corner dots
            this.corners = this.tracker.children(".dot");
            //Insert tracker into image wrapper
            this.tracker.appendTo(this.imageWrapper);
        },

        _initiallyPositionTracker: function () {
            //Set default position and dimension coords
            var x = 0,
                y = 0,
                width = this.imageWidth,
                height = this.imageHeight;

            if (this.initialCoordinates) {
                //Determine scale between original and scaled image dimensions
                var widthScale = this.fullWidth / this.image.width(),
                    heightScale = this.fullHeight / this.image.height();
                //Set to initial coordinates
                width = Math.round(this.initialCoordinates.width / widthScale);
                height = Math.round(this.initialCoordinates.height / heightScale);
                x = Math.round(this.initialCoordinates.left / widthScale);
                y = Math.round(this.initialCoordinates.top / heightScale);
            }
            else {
                //Scale to ratio if ratio is set
                if (this.ratio) {
                    if (this.imageWidth / this.imageHeight > this.ratio) {
                        //Image is wider than ratio, position tracker centered
                        width = this.imageHeight * this.ratio;
                        x = (this.imageWidth - width) / 2;
                    }
                    else {
                        //Image is taller than ratio, position tracker centered
                        height = this.imageWidth / this.ratio;
                        y = (this.imageHeight - height) / 2;
                    }
                }
            }

            //Update tracker position in DOM
            this.tracker.css({
                left: x,
                top: y,
                width: width,
                height: height
            });
        },

        getCoords: function () {
            //Determine scale between original and scaled image dimensions
            var widthScale = this.fullWidth / this.image.width(),
                heightScale = this.fullHeight / this.image.height(),
            //Determine width and height of selected area in original size
                width = Math.ceil(this.tracker.width() * widthScale),
                height = Math.ceil(this.tracker.height() * heightScale),
            //Determine offset of selected area in original size
                left = Math.round(this.tracker.position().left * widthScale),
                top = Math.round(this.tracker.position().top * heightScale);
            //Ensure cropped image width is at least minimum width
            if (width < this.minWidth) {
                width = this.minWidth;
            }
            //Ensure cropped image height is at least minimum height
            if (height < this.minHeight) {
                height = this.minHeight;
            }
            //Ensure cropped image width is inside original image width
            if (width >= this.fullWidth) {
                width = this.fullWidth;
                left = 0;
            }
            else if (width + left >= this.fullWidth) {
                left = this.fullWidth - width;
            }
            //Ensure cropped image height is inside original image height
            if (height >= this.fullHeight) {
                height = this.fullHeight;
                top = 0;
            }
            else if (height + top >= this.fullHeight) {
                top = this.fullHeight - height;
            }
            //Ensure cropped image stays on ratio
            if (this.ratio) {
                var i = 0;
                //Check for exact ratio matches, but only allow up to 4 loops
                while ((width / this.ratio !== height || height * this.ratio !== width) && i < 4) {
                    //Get width and height from opposite dimensions via ratio
                    var newWidth = height * this.ratio,
                        newHeight = width / this.ratio;

                    if (newWidth % 1 === 0) {
                        //Initial height provides usuable width from ratio
                        width = newWidth;
                        height = newWidth / this.ratio;
                    }
                    else if (newHeight % 1 === 0) {
                        //Initial width provides usuable height from ratio
                        width = newHeight * this.ratio;
                        height = newHeight;
                    }
                    else {
                        //Try to decrease each dimension to match ratio
                        width -= 1;
                        height -= 1;
                    }
                    i++;
                }
            }

            return {
                left: left,
                top: top,
                width: width,
                height: height
            };
        }
    });

    return CropTool;
});
